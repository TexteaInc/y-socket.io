import type { Server as HTTPServer } from 'http'
import { Server, Socket } from 'socket.io'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { AwarenessChanges, getClients } from '../../awareness'
import type { ClientToServerEvents, ServerToClientEvents } from '../../events'
import type { Persistence } from '../../persistence'
import type { ClientId, DefaultClientData, RoomName } from '../../types'
import type { Room } from './room'
import type { GetUserId, UserId } from './user'

declare module 'socket.io' {
  /**
   * Data related to yjs
   */
  interface SocketYjsData {
    roomName: RoomName
    clientId: ClientId
  }
  interface Socket {
    yjs: SocketYjsData
    userId: UserId
  }
}

export interface Options {
  /**
   * Handle auth and room permission
   */
  getUserId?: GetUserId
  persistence?: Persistence
  /**
   * @default false
   */
  autoDeleteRoom?: boolean
}

type CreateSocketIOServer = <ClientData extends DefaultClientData = DefaultClientData>(
  httpServer: HTTPServer,
  options?: Options
) => Server<ClientToServerEvents, ServerToClientEvents<ClientData>>

/**
 * There are four scenarios:
 *  1. Signed User share sheet to specified person with write permission (both side need authorization)
 *  2. Signed User share sheet to specified person with only view permission (both side need authorization)
 *  3. Signed User share sheet to everyone with write permission (only one side need authorization)
 *  4. Signed User share sheet to everyone with only view permission (only one side need authorization)
 *
 *  If sheet owner close sharing (or disable sharing), others won't see the sheet anymore,
 *    which means we will delete the sheet in their browser.
 *
 * We only consider scenario 3 for now, because It's easy to implement
 */

export const createSocketIOServer: CreateSocketIOServer = <ClientData extends DefaultClientData = DefaultClientData>(
  httpServer: HTTPServer,
  { getUserId, persistence, autoDeleteRoom = false }: Options = {}
) => {
  const roomMap = new Map<RoomName, Room>()

  const io = new Server<ClientToServerEvents, ServerToClientEvents<ClientData>>(httpServer, {
    cors: process.env.NODE_ENV === 'development' ? {} : undefined
  })

  io.use((socket, next) => {
    const { roomName, clientId } = socket.handshake.query
    if (typeof roomName !== 'string') {
      return next(new Error("wrong type of query parameter 'roomName'"))
    }
    if (typeof clientId !== 'string' || Number.isNaN(+clientId)) {
      return next(new Error("wrong type of query parameter 'clientId'"))
    }
    socket.yjs = {
      roomName,
      clientId: Number(clientId)
    }
    return next()
  })

  io.use((socket, next) => {
    const result = getUserId?.(socket) ?? socket.yjs.clientId
    if (result instanceof Error) {
      return next(result)
    }
    socket.userId = result
    return next()
  })

  const { adapter } = io.of('/')

  adapter.on('create-room', (roomName: RoomName) => {
    if (adapter.sids.has(roomName) || roomMap.has(roomName)) {
      //        ^^^^ Map<SocketId, Set<RoomName>>
      return
    }
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    // delete local `clientId` from `awareness.getStates()` Map
    awareness.setLocalState(null)
    awareness.on('update', (changes: AwarenessChanges, origin: Socket['id']) => {
      const changedClients = Object.values(changes).reduce((res, cur) => [...res, ...cur])
      const update = encodeAwarenessUpdate(awareness, changedClients)
      io.to(roomName).except(origin).emit('awareness:update', update)
    })
    const prepareDoc = async (): Promise<Y.Doc> => {
      await persistence?.bindState(roomName, doc)
      doc.on('update', (updateV1: Uint8Array, origin: Socket['id']) => {
        const updateV2 = Y.convertUpdateFormatV1ToV2(updateV1)
        io.to(roomName).except(origin).emit('doc:update', updateV2)
      })
      return doc
    }
    const preparingDoc = prepareDoc()
    const room: Room = {
      owner: null!,
      awareness,
      getDoc: () => preparingDoc,
      destroy: async () => {
        await persistence?.writeState(roomName, doc)
        doc.destroy()
        awareness.destroy()
      }
    }
    roomMap.set(roomName, room)
  })

  if (autoDeleteRoom) {
    adapter.on('delete-room', (roomName: RoomName) => {
      const room = roomMap.get(roomName)
      if (!room) {
        return
      }
      void room.destroy()
      roomMap.delete(roomName)
    })
  }

  io.on('connection', (socket) => {
    const { roomName } = socket.yjs
    socket.join(roomName)

    const room = roomMap.get(roomName)!
    if (room.owner === null) {
      room.owner = socket.userId
    }
    const clients = getClients(room.awareness)
    if (clients.length) {
      const awarenessUpdate = encodeAwarenessUpdate(room.awareness, clients)
      socket.emit('awareness:update', awarenessUpdate)
    }
    room.getDoc().then((doc) => {
      const docDiff = Y.encodeStateVector(doc)
      socket.emit('doc:diff', docDiff)
    })

    socket.on('room:close', () => {
      const room = roomMap.get(roomName)
      if (!room || socket.userId !== room.owner) {
        return
      }
      void room.destroy()
      roomMap.delete(roomName)
      socket.to(roomName).disconnectSockets(true)
    })
    socket.on('doc:diff', (diff) => {
      const room = roomMap.get(roomName)
      if (!room) {
        return
      }
      room.getDoc().then((doc) => {
        const updateV2 = Y.encodeStateAsUpdateV2(doc, diff)
        socket.emit('doc:update', updateV2)
      })
    })
    socket.on('doc:update', (updateV2, callback) => {
      const room = roomMap.get(roomName)
      if (!room) {
        return
      }
      room.getDoc().then((doc) => {
        Y.applyUpdateV2(doc, updateV2, socket.id)
        callback?.()
      })
    })
    socket.on('awareness:update', (update) => {
      const room = roomMap.get(roomName)
      if (!room) {
        return
      }
      applyAwarenessUpdate(room.awareness, update, socket.id)
    })
    socket.on('disconnect', () => {
      const room = roomMap.get(roomName)
      if (!room) {
        return
      }
      const { clientId } = socket.yjs
      removeAwarenessStates(room.awareness, [clientId], socket.id)
    })
  })

  return io
}
