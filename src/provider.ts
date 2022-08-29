import { io, Socket } from 'socket.io-client'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'

import type { AwarenessChanges, ClientToServerEvents, ServerToClientEvents } from './types'

export interface Options {
  autoConnect?: boolean
  awareness?: Awareness
}

export interface SocketIOProvider {
  connect: () => void
  disconnect: () => void
  destroy: () => void
}

export const createSocketIOProvider = (
  serverUrl: string,
  roomName: string,
  yDoc: Y.Doc,
  {
    autoConnect = false,
    awareness = new Awareness(yDoc)
  }: Options = {}
): SocketIOProvider => {
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl, {
    autoConnect
  })

  socket.on('connect', () => {
    socket.emit('join', roomName)
    const yDocDiff = Y.encodeStateVector(yDoc)
    socket.emit('yDoc:diff', roomName, yDocDiff)
    if (awareness.getLocalState() !== null) {
      const awarenessUpdate = encodeAwarenessUpdate(awareness, [yDoc.clientID])
      socket.emit('awareness:update', roomName, awarenessUpdate)
    }
  })
  socket.on('yDoc:diff', (diff) => {
    const update = Y.encodeStateAsUpdateV2(yDoc, new Uint8Array(diff))
    socket.emit('yDoc:update', roomName, update)
  })
  socket.on('yDoc:update', (update) => {
    Y.applyUpdateV2(yDoc, new Uint8Array(update), socket)
  })
  socket.on('awareness:update', (update) => {
    applyAwarenessUpdate(awareness, new Uint8Array(update), socket)
  })

  const handleYDocUpdate = (update: Uint8Array, origin: null | Socket) => {
    if (origin !== socket) {
      const updateV2 = Y.convertUpdateFormatV1ToV2(update)
      socket.emit('yDoc:update', roomName, updateV2)
    }
  }
  yDoc.on('update', handleYDocUpdate)

  const handleAwarenessUpdate = (changes: AwarenessChanges, origin: 'local' | Socket) => {
    if (origin !== socket) {
      const changedClients = Object.values(changes).reduce((res, cur) => [...res, ...cur])
      const update = encodeAwarenessUpdate(awareness, changedClients)
      socket.emit('awareness:update', roomName, update)
    }
  }
  awareness.on('update', handleAwarenessUpdate)

  const handleBeforeUnload = () => {
    removeAwarenessStates(awareness, [yDoc.clientID], null)
  }
  window.addEventListener('beforeunload', handleBeforeUnload)

  return {
    connect: () => {
      socket.connect()
    },
    disconnect: () => {
      socket.disconnect()
    },
    destroy: () => {
      socket.disconnect()
      yDoc.off('update', handleYDocUpdate)
      awareness.off('update', handleAwarenessUpdate)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }
}
