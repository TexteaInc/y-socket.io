import type { Server as HTTPServer } from 'http'
import { Server, Socket } from 'socket.io'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'

import type { AwarenessChanges } from '../../awareness'
import { getClients } from '../../awareness'
import type { ClientToServerEvents, ServerToClientEvents } from '../../events'
import type { Persistence } from '../../persistence'
import type { ClientId, RoomName } from '../../types'
import type { GetDoc, Room } from './room'
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
  getUserId?: GetUserId
  persistence?: Persistence
}

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

export const createSocketServer = (httpServer: HTTPServer, { getUserId, persistence }: Options = {}) => {
  const roomMap = new Map<RoomName, Room>()

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: process.env.NODE_ENV === 'development' ? {} : undefined
  })

  io.use((socket, next) => {
    // handle auth and room permission
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
    const prepareDoc = async (): Promise<Y.Doc> => {
      await persistence?.bindState(roomName, doc)
      doc.on('update', (updateV1: Uint8Array, origin: Socket['id']) => {
        const updateV2 = Y.convertUpdateFormatV1ToV2(updateV1)
        io.to(roomName).except(origin).emit('doc:update', updateV2)
      })
      return doc
    }
    const preparingDoc = prepareDoc()
    const getDoc: GetDoc = () => preparingDoc
    const awareness = new Awareness(doc)
    // delete local `clientId` from `awareness.getStates()` Map
    awareness.setLocalState(null)
    awareness.on('update', (changes: AwarenessChanges, origin: Socket['id']) => {
      const changedClients = Object.values(changes).reduce((res, cur) => [...res, ...cur])
      const update = encodeAwarenessUpdate(awareness, changedClients)
      io.to(roomName).except(origin).emit('awareness:update', update)
    })
    roomMap.set(roomName, {
      owner: null!,
      getDoc,
      awareness
    })
  })

  io.on('connection', (socket) => {
    const { roomName } = socket.yjs
    socket.join(roomName)

    const room = roomMap.get(roomName)!
    if (room.owner === null) {
      room.owner = socket.userId
    }
    room.getDoc().then((doc) => {
      const docDiff = Y.encodeStateVector(doc)
      socket.emit('doc:diff', docDiff)
    })
    const awarenessStates = room.awareness.getStates()
    if (awarenessStates.size) {
      const clients = getClients(room.awareness)
      const awarenessUpdate = encodeAwarenessUpdate(room.awareness, clients)
      socket.emit('awareness:update', awarenessUpdate)
    }

    socket.on('room:close', () => {
      const room = roomMap.get(roomName)
      if (!room || socket.userId !== room.owner) {
        return
      }
      const destroyDoc = async (): Promise<void> => {
        const doc = await room.getDoc()
        await persistence?.writeState(roomName, doc)
        doc.destroy()
      }
      void destroyDoc()
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
