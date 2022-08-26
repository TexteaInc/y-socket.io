import type { Server as HTTPServer } from 'http'
import { Server } from 'socket.io'
import * as Y from 'yjs'

import type { ClientToServerEvents, ServerToClientEvents } from '../../types'

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
  const yDocMap = new Map<string, Y.Doc>()

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer)

  io.on('connection', (socket) => {
    socket.on('join', (roomName) => {
      socket.join(roomName)
      let yDoc: Y.Doc
      if (yDocMap.has(roomName)) {
        yDoc = yDocMap.get(roomName)!
      } else {
        yDoc = new Y.Doc()
        // todo: bind persistence
        yDoc.on('update', (update, origin) => {
          const updateV2 = Y.convertUpdateFormatV1ToV2(update)
          io.to(roomName).except(origin).emit('doc:update', updateV2)
        })
        yDocMap.set(roomName, yDoc)
      }
      const diff = Y.encodeStateVector(yDoc)
      socket.emit('doc:diff', diff)
    })
    socket.on('doc:diff', (roomName, diff) => {
      const yDoc = yDocMap.get(roomName)
      if (!yDoc) {
        console.error('yDoc is null')
      } else {
        const update = Y.encodeStateAsUpdateV2(yDoc, diff)
        socket.emit('doc:update', update)
      }
    })
    socket.on('doc:update', (roomName, update) => {
      const yDoc = yDocMap.get(roomName)
      if (!yDoc) {
        console.error('yDoc is null')
      } else {
        Y.applyUpdateV2(yDoc, update, socket.id)
      }
    })
  })

  return io
}
