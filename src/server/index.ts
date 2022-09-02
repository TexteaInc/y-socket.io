import { createServer } from 'http'

import type { Persistence } from '../persistence'
import { createSocketServer } from './socket'

export const createYDocServer = (persistence?: Persistence) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('"okay"')
  })

  const socketServer = createSocketServer(server, persistence)

  return server
}
