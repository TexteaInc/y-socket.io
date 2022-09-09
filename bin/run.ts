#!/usr/bin/env ts-node
import { createSimpleServer } from '../src/server'

const host = process.env.HOST || 'localhost'
const port = +(process.env.PORT || 1234)

const server = createSimpleServer()
server.listen(port, host, () => {
  console.log(`running at '${host}' on port ${port}`)
})
