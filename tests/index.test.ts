import { WebsocketProvider } from '@textea/sheet'
import type { AddressInfo } from 'net'
import nodeAssert from 'node:assert'
import { beforeEach, describe, test } from 'vitest'
import * as Y from 'yjs'

import { createYDocServer } from '../src/server'

nodeAssert.ok(process.env.CLERK_API_KEY)

let port: number = null!

describe('server', () => {
  beforeEach(() => {
    const server = createYDocServer()
    server.listen()
    const address = server.address()
    port = (address as AddressInfo).port
  })

  test('connect the serve without login', async () => {
    return new Promise<void>((resolve, reject) => {
      const address = `ws://localhost:${port}`
      const yDoc = new Y.Doc()
      const wsProvider = new WebsocketProvider(address, 'test-room', yDoc, {
        token: '',
        params: {
          headerToken: '1',
          cookieToken: '2',
          clientUat: '3'
        }
      })
      wsProvider.ws!.addEventListener('open', () => {
        wsProvider.ws!.send(JSON.stringify({ headerToken: '123' }))
      }, {
        once: true
      })
    })
  })
})
