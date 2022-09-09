import type { AddressInfo } from 'net'
import { beforeEach, describe, test } from 'vitest'

import { createSimpleServer } from '../src/server'

let port: number = null!

describe('server', () => {
  beforeEach(() => {
    const server = createSimpleServer()
    server.listen()
    const address = server.address()
    port = (address as AddressInfo).port
  })

  test('connect the serve without login', async () => {
  })
})
