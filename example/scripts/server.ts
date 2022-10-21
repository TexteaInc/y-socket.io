#!/usr/bin/env ts-node
import { createSocketIOServer } from '@textea/y-socket.io/server'
import { createServer } from 'http'

import { ClientData } from '../src/types'

const host = process.env.HOST || 'localhost'
const port = +(process.env.PORT || 1234)

const httpServer = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end('"okay"')
})

const io = createSocketIOServer<ClientData>(httpServer, {
  autoDeleteRoom: process.env.NODE_ENV === 'development',
  cors: {}
})

io.on('connection', (socket) => {
  const { roomMap, roomName } = socket.yjs
  const room = roomMap.get(roomName)!
  socket.emit('data:update', {
    isOwner: socket.userId === room.owner
  })
})

httpServer.listen(port, host, () => {
  console.log(`running at '${host}' on port ${port}`)
})
