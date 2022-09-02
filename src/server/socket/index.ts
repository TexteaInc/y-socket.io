import type { Server as HTTPServer } from 'http'
import { Server, Socket } from 'socket.io'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'

import type { Persistence } from '../../persistence'
import type { AwarenessChanges, ClientToServerEvents, ServerToClientEvents } from '../../types'
import { createRoomMap, Room } from './room'

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

export const createSocketServer = (httpServer: HTTPServer, persistence?: Persistence) => {
  const roomMap = createRoomMap()

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: process.env.NODE_ENV === 'development' ? {} : undefined
  })

  const { adapter } = io.of('/')

  adapter.on('create-room', (roomName: string) => {
    // socket default room
    if (adapter.sids.has(roomName)) {
      return
    }
    const createRoom = async (): Promise<Room> => {
      const doc = new Y.Doc()
      await persistence?.bindState(roomName, doc)
      doc.on('update', (updateV1: Uint8Array, origin: Socket['id']) => {
        const updateV2 = Y.convertUpdateFormatV1ToV2(updateV1)
        io.to(roomName).except(origin).emit('doc:update', updateV2)
      })
      const awareness = new Awareness(doc)
      // delete local `clientId` from `awareness.getStates()` Map
      awareness.setLocalState(null)
      awareness.on('update', (changes: AwarenessChanges, origin: Socket['id']) => {
        const changedClients = Object.values(changes).reduce((res, cur) => [...res, ...cur])
        const update = encodeAwarenessUpdate(awareness, changedClients)
        io.to(roomName).except(origin).emit('awareness:update', update)
      })
      return { doc, awareness }
    }
    roomMap.set(roomName, createRoom())
  })
  adapter.on('delete-room', (roomName: string) => {
    // socket default room
    if (adapter.sids.has(roomName)) {
      return
    }
    const loadingRoom = roomMap.get(roomName)!
    const destroyRoom = async () => {
      const room = await loadingRoom
      await persistence?.writeState(roomName, room.doc)
      room.doc.destroy()
      room.awareness.destroy()
    }
    destroyRoom()
    roomMap.delete(roomName)
  })

  io.on('connection', (socket) => {
    socket.on('join', (roomName) => {
      socket.join(roomName)
      roomMap.get(roomName)!.then((room) => {
        const docDiff = Y.encodeStateVector(room.doc)
        socket.emit('doc:diff', docDiff)
        const awarenessStates = room.awareness.getStates()
        if (awarenessStates.size) {
          const clients = [...awarenessStates.keys()]
          const awarenessUpdate = encodeAwarenessUpdate(room.awareness, clients)
          socket.emit('awareness:update', awarenessUpdate)
        }
      })
    })
    socket.on('doc:diff', (roomName, diff) => {
      roomMap.get(roomName)?.then((room) => {
        const updateV2 = Y.encodeStateAsUpdateV2(room.doc, diff)
        socket.emit('doc:update', updateV2)
      })
    })
    socket.on('doc:update', (roomName, updateV2, callback) => {
      roomMap.get(roomName)?.then((room) => {
        Y.applyUpdateV2(room.doc, updateV2, socket.id)
        callback?.()
      })
    })
    socket.on('awareness:update', (roomName, update) => {
      roomMap.get(roomName)?.then((room) => {
        applyAwarenessUpdate(room.awareness, update, socket.id)
      })
    })
  })

  return io
}
