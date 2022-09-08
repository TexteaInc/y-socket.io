import { createServer } from 'http'

import { createSocketServer, Options } from './socket'

export const createYDocServer = (options: Options = {}) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('"okay"')
  })

  createSocketServer(server, options)

  return server
}
