import { createServer as createHTTPServer, Server as HTTPServer } from 'http'

import { createSocketIOServer, Options } from './socket'

export * from './socket'

export const createSimpleServer = (options: Options = {}): HTTPServer => {
  const httpServer = createHTTPServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('"okay"')
  })
  createSocketIOServer(httpServer, options)
  return httpServer
}
