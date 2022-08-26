import type { AddressInfo } from 'net'
import * as nodeAssert from 'node:assert'
import { beforeEach, describe, test } from 'vitest'

import { createYDocServer } from '../src'

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
  })
})
