import type { Server as HTTPServer } from 'http'
import { Server, Socket } from 'socket.io'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'

import type { AwarenessChanges, ClientToServerEvents, ServerToClientEvents } from '../../types'

type Room = {
  doc: Y.Doc
  awareness: Awareness
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

export const createSocketServer = (httpServer: HTTPServer) => {
  const roomMap = new Map<string, Room>()

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: process.env.NODE_ENV === 'development' ? {} : undefined
  })

  io.on('connection', (socket) => {
    socket.on('join', (roomName) => {
      socket.join(roomName)
      let room: Room
      if (roomMap.has(roomName)) {
        room = roomMap.get(roomName)!
      } else {
        const doc = new Y.Doc()
        // todo: bind persistence
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
        room = { doc, awareness }
        roomMap.set(roomName, room)
      }
      const docDiff = Y.encodeStateVector(room.doc)
      socket.emit('doc:diff', docDiff)
      const awarenessStates = room.awareness.getStates()
      if (awarenessStates.size) {
        const clients = [...awarenessStates.keys()]
        const awarenessUpdate = encodeAwarenessUpdate(room.awareness, clients)
        socket.emit('awareness:update', awarenessUpdate)
      }
    })
    socket.on('doc:diff', (roomName, diff) => {
      const room = roomMap.get(roomName)
      if (!room) {
        console.error('room is null')
      } else {
        const updateV2 = Y.encodeStateAsUpdateV2(room.doc, diff)
        socket.emit('doc:update', updateV2)
      }
    })
    socket.on('doc:update', (roomName, updateV2, callback) => {
      const room = roomMap.get(roomName)
      if (!room) {
        console.error('room is null')
      } else {
        Y.applyUpdateV2(room.doc, updateV2, socket.id)
        callback?.()
      }
    })
    socket.on('awareness:update', (roomName, update) => {
      const room = roomMap.get(roomName)
      if (!room) {
        console.error('room is null')
      } else {
        applyAwarenessUpdate(room.awareness, update, socket.id)
      }
    })
  })

  io.sockets.adapter.on('delete-room', (roomName: string) => {
    if (roomMap.has(roomName)) {
      const room = roomMap.get(roomName)!
      room.doc.destroy()
      room.awareness.destroy()
      roomMap.delete(roomName)
    }
  })

  return io
}
