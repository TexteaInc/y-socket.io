import { createServer } from 'http'

import { createSocketServer } from './socket'

export const createYDocServer = () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('"okay"')
  })

  const socketServer = createSocketServer(server)

  return server
}
