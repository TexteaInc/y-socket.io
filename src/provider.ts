import { Observable } from 'lib0/observable'
import { io, Socket } from 'socket.io-client'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'

import type { AwarenessChanges, ClientToServerEvents, ServerToClientEvents } from './types'

interface Options {
  autoConnect?: boolean
  awareness?: Awareness
}

export class SocketIOProvider extends Observable<string> {
  private readonly yDoc: Y.Doc
  private readonly awareness: Awareness
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>

  private readonly handleUpdate: (update: Uint8Array, origin: this | null) => void
  private readonly handleAwarenessUpdate: (changes: AwarenessChanges, origin: 'local' | this | null) => void
  private readonly handleBeforeUnload: () => void

  constructor (
    serverUrl: string,
    roomName: string,
    yDoc: Y.Doc,
    {
      autoConnect = false,
      awareness = new Awareness(yDoc)
    }: Options = {}
  ) {
    super()
    this.yDoc = yDoc
    this.awareness = awareness

    this.socket = io(serverUrl, {
      autoConnect
    })
    this.socket.on('connect', () => {
      this.socket.emit('join', roomName)
      const yDocDiff = Y.encodeStateVector(this.yDoc)
      this.socket.emit('doc:diff', roomName, yDocDiff)
      if (this.awareness.getLocalState() !== null) {
        const awarenessUpdate = encodeAwarenessUpdate(this.awareness, [this.yDoc.clientID])
        this.socket.emit('awareness:update', roomName, awarenessUpdate)
      }
    })
    this.socket.on('doc:diff', (diff) => {
      const update = Y.encodeStateAsUpdateV2(this.yDoc, new Uint8Array(diff))
      this.socket.emit('doc:update', roomName, update)
    })
    this.socket.on('doc:update', (update) => {
      Y.applyUpdateV2(this.yDoc, new Uint8Array(update), this)
    })
    this.socket.on('awareness:update', (update) => {
      applyAwarenessUpdate(this.awareness, new Uint8Array(update), this)
    })
    this.socket.on('disconnect', () => {
      removeAwarenessStates(this.awareness, [this.yDoc.clientID], null)
    })

    this.handleUpdate = (update, origin) => {
      if (origin !== this) {
        const updateV2 = Y.convertUpdateFormatV1ToV2(update)
        this.socket.emit('doc:update', roomName, updateV2)
      }
    }
    this.yDoc.on('update', this.handleUpdate)

    this.handleAwarenessUpdate = (changes, origin) => {
      if (origin !== this) {
        const changedClients = Object.values(changes).reduce((res, cur) => [...res, ...cur])
        const update = encodeAwarenessUpdate(this.awareness, changedClients)
        this.socket.emit('awareness:update', roomName, update)
      }
    }
    this.awareness.on('update', this.handleAwarenessUpdate)

    this.handleBeforeUnload = () => {
      this.disconnect()
    }
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
    this.awareness.off('update', this.handleAwarenessUpdate)
    window.removeEventListener('beforeunload', this.handleBeforeUnload)
    super.destroy()
  }
}
