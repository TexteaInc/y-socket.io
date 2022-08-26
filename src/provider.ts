import { Observable } from 'lib0/observable'
import { io, Socket } from 'socket.io-client'
import * as Y from 'yjs'

import type { ClientToServerEvents, ServerToClientEvents } from './types'

interface Options {
  autoConnect?: boolean
}

export class SocketIOProvider extends Observable<string> {
  private readonly yDoc: Y.Doc
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>

  private readonly handleUpdate: (update: Uint8Array, origin: unknown) => void
  private readonly handleBeforeUnload: () => void

  constructor (serverUrl: string, roomName: string, yDoc: Y.Doc, { autoConnect = false }: Options = {}) {
    super()
    this.yDoc = yDoc

    this.socket = io(serverUrl, {
      autoConnect
    })
    this.socket.on('connect', () => {
      this.socket.emit('join', roomName)
      const diff = Y.encodeStateVector(this.yDoc)
      this.socket.emit('doc:diff', roomName, diff)
    })
    this.socket.on('doc:diff', (diff) => {
      const update = Y.encodeStateAsUpdateV2(this.yDoc, new Uint8Array(diff))
      this.socket.emit('doc:update', roomName, update)
    })
    this.socket.on('doc:update', (update) => {
      Y.applyUpdateV2(this.yDoc, new Uint8Array(update), this)
    })

    this.handleUpdate = (update, origin) => {
      if (origin !== this) {
        const updateV2 = Y.convertUpdateFormatV1ToV2(update)
        this.socket.emit('doc:update', roomName, updateV2)
      }
    }
    this.yDoc.on('update', this.handleUpdate)

    this.handleBeforeUnload = () => {}
    window.addEventListener('beforeunload', this.handleBeforeUnload)
  }

  public connect () {
    this.socket.connect()
  }

  public disconnect () {
    this.socket.disconnect()
  }

  override destroy () {
    this.disconnect()
    this.yDoc.off('update', this.handleUpdate)
    window.removeEventListener('beforeunload', this.handleBeforeUnload)
    super.destroy()
  }
}
