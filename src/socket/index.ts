/**
 * References:
 *  https://discuss.yjs.dev/t/spend-almost-4-days-trying-to-understand-yjs-but-alas/117/2
 */
import { AuthStatus, createGetToken } from '@clerk/backend-core'
import clerk, { StrictAuthProp } from '@clerk/clerk-sdk-node'
import { createPersistence, Persistence } from '@textea/persistence'
import { parse } from 'cookie'
import type { Server as HTTPServer } from 'http'
import { Server } from 'socket.io'
import * as Y from 'yjs'

declare module 'socket.io' {
  export interface Socket {
    auth: StrictAuthProp
    persistence: Persistence
  }
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
  const yDocMap = new Map<string, Y.Doc>()

  const app = new Server(httpServer)
  // Docs: https://socket.io/docs/v4/middlewares/
  app.use(async (socket, next) => {
    const request = socket.request
    const cookies = parse(socket.request.headers.cookie ?? '')
    const cookieToken = cookies.__session
    const headerToken = socket.request.headers.authorization?.replace('Bearer ',
      '')
    const { status, interstitial, sessionClaims, errorReason } =
      await clerk.base.getAuthState({
        cookieToken,
        headerToken,
        clientUat: cookies.__client_uat,
        origin: request.headers.origin,
        host: request.headers.host as string,
        forwardedPort: request.headers['x-forwarded-port'] as string,
        forwardedHost: request.headers['x-forwarded-host'] as string,
        referrer: request.headers.referer,
        userAgent: request.headers['user-agent'] as string,
        authorizedParties: [],
        jwtKey: clerk.jwtKey,
        fetchInterstitial: () => clerk.fetchInterstitial()
      })
    if (status === AuthStatus.SignedIn) {
      Object.assign(socket, {
        auth: {
          sessionId: sessionClaims?.sid,
          userId: sessionClaims?.sub,
          getToken: createGetToken({
            headerToken,
            cookieToken,
            sessionId: sessionClaims?.sid,
            fetcher: (
              sessionId: string, template: string
            ) => clerk.sessions.getToken(sessionId, template)
          }),
          claims: sessionClaims
        }
      } as StrictAuthProp)
      Object.assign(socket, {
        persistence: createPersistence(sessionClaims!.sub)
      })
      next()
    } else {
      next(new Error('unauthorized'))
    }
  })

  const sheetNamespace = app.of('/sheet')

  app.on('connect', (socket) => {
    socket.on('share', (roomName: string, binary: Uint8Array) => {
      if (!yDocMap.has(roomName)) {
        const yDoc = new Y.Doc()
        socket.persistence.bindState(roomName, yDoc)
        Y.applyUpdateV2(yDoc, binary)
        yDocMap.set(roomName, yDoc)
      }
    })
    socket.on('close', (roomName: string) => {
      const yDoc = yDocMap.get(roomName)
      if (yDoc == null) {
        console.error('yDoc is null')
      } else {
        socket.persistence.writeState(roomName, yDoc)
        yDoc.destroy()
        yDocMap.delete(roomName)
      }
      sheetNamespace.to(roomName).emit('close')
    })
  })

  sheetNamespace.on('connect', (socket) => {
    socket.on('join', (roomName: string) => {
      if (yDocMap.has(roomName)) {
        socket.join(roomName)
        const yDoc = yDocMap.get(roomName)!
        const updateV2 = Y.encodeStateAsUpdateV2(yDoc)
        sheetNamespace.to(socket.id).emit('update-doc', roomName, updateV2)
      } else {
        // sharing is disabled or the sharer is offline
        // todo: send error message to client
      }
    })
    socket.on('update-doc', (roomName: string, binary: Uint8Array) => {
      const yDoc = yDocMap.get(roomName)
      if (yDoc == null) {
        console.error('yDoc is null')
      } else {
        Y.applyUpdateV2(yDoc, binary)
        sheetNamespace.to(roomName).emit('update-doc', roomName, binary)
      }
    })
  })

  return app
}
