import type { Server as HTTPServer } from 'http'
import { Server } from 'socket.io'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'

import type { AwarenessChanges, ClientToServerEvents, ServerToClientEvents } from '../../types'

type Room = {
  yDoc: Y.Doc
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
        const yDoc = new Y.Doc()
        // todo: bind persistence
        yDoc.on('update', (update: Uint8Array, origin: string) => {
          const updateV2 = Y.convertUpdateFormatV1ToV2(update)
          io.to(roomName).except(origin).emit('yDoc:update', updateV2)
        })
        const awareness = new Awareness(yDoc)
        awareness.on('update', (changes: AwarenessChanges, origin: string) => {
          const changedClients = Object.values(changes)
            .reduce((res, cur) => [...res, ...cur])
            .filter((clientId) => clientId !== yDoc.clientID)
          if (changedClients.length) {
            const update = encodeAwarenessUpdate(awareness, changedClients)
            io.to(roomName).except(origin).emit('awareness:update', update)
          }
        })
        room = { yDoc, awareness }
        roomMap.set(roomName, room)
      }
      const yDocDiff = Y.encodeStateVector(room.yDoc)
      socket.emit('yDoc:diff', yDocDiff)
      const clients = [...room.awareness.getStates().keys()].filter(
        (clientId) => clientId !== room.yDoc.clientID
      )
      if (clients.length) {
        const awarenessUpdate = encodeAwarenessUpdate(room.awareness, clients)
        socket.emit('awareness:update', awarenessUpdate)
      }
    })
    socket.on('yDoc:diff', (roomName, diff) => {
      const room = roomMap.get(roomName)
      if (!room) {
        console.error('room is null')
      } else {
        const update = Y.encodeStateAsUpdateV2(room.yDoc, diff)
        socket.emit('yDoc:update', update)
      }
    })
    socket.on('yDoc:update', (roomName, update, callback) => {
      const room = roomMap.get(roomName)
      if (!room) {
        console.error('room is null')
      } else {
        Y.applyUpdateV2(room.yDoc, update, socket.id)
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

  return io
}
