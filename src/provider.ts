import { io, Socket } from 'socket.io-client'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { createStore, Mutate, StoreApi } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

import type { AwarenessChanges, ClientToServerEvents, ServerToClientEvents } from './types'

export interface Options {
  autoConnect?: boolean
  awareness?: Awareness
}

export interface SocketIOProviderState {
  connecting: boolean
  connected: boolean
  synced: boolean
  error: string | null
}

/**
 * @internal
 */
export const INITIAL_STATE: Readonly<SocketIOProviderState> = {
  connecting: false,
  connected: false,
  synced: false,
  error: null
}

type ReadonlyStore<Store extends StoreApi<unknown>> = Omit<Store, 'setState'>

type SocketIOProviderStore = ReadonlyStore<
  Mutate<StoreApi<SocketIOProviderState>, [['zustand/subscribeWithSelector', never]]>
>

export interface SocketIOProvider extends SocketIOProviderStore {
  connect: () => void
  disconnect: () => void
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
  const store = createStore<SocketIOProviderState>()(
    subscribeWithSelector(() => ({
      ...INITIAL_STATE,
      connecting: autoConnect
    }))
  )

  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl, {
    autoConnect
  })

  socket.on('connect_error', (err) => {
    store.setState({
      connecting: false,
      error: err.message
    })
  })
  socket.on('connect', () => {
    socket.emit('join', roomName)
    const yDocDiff = Y.encodeStateVector(yDoc)
    socket.emit('yDoc:diff', roomName, yDocDiff)
    if (awareness.getLocalState() !== null) {
      const awarenessUpdate = encodeAwarenessUpdate(awareness, [yDoc.clientID])
      socket.emit('awareness:update', roomName, awarenessUpdate)
    }
    store.setState({
      connecting: false,
      connected: true,
      error: null
    })
  })
  socket.on('yDoc:diff', (diff) => {
    const update = Y.encodeStateAsUpdateV2(yDoc, new Uint8Array(diff))
    socket.emit('yDoc:update', roomName, update)
  })
  socket.on('yDoc:update', (update) => {
    Y.applyUpdateV2(yDoc, new Uint8Array(update), socket)
    store.setState({
      synced: true
    })
  })
  socket.on('awareness:update', (update) => {
    applyAwarenessUpdate(awareness, new Uint8Array(update), socket)
  })
  socket.on('disconnect', (_reason, description) => {
    const clients = [...awareness.getStates().keys()].filter(
      (clientId) => clientId !== yDoc.clientID
    )
    removeAwarenessStates(awareness, clients, socket)
    const err = description instanceof Error ? description.message : null
    store.setState({
      connecting: false,
      connected: false,
      error: err
    })
  })

  const handleYDocUpdate = (update: Uint8Array, origin: null | Socket) => {
    if (origin !== socket) {
      const updateV2 = Y.convertUpdateFormatV1ToV2(update)
      socket.emit('yDoc:update', roomName, updateV2)
    }
  }
  yDoc.on('update', handleYDocUpdate)

  const handleAwarenessUpdate = (changes: AwarenessChanges, origin: string | Socket) => {
    if (origin !== socket) {
      const changedClients = Object.values(changes).reduce((res, cur) => [...res, ...cur])
      const update = encodeAwarenessUpdate(awareness, changedClients)
      socket.emit('awareness:update', roomName, update)
    }
  }
  awareness.on('update', handleAwarenessUpdate)

  return {
    getState: store.getState,
    connect: () => {
      const { connecting, connected } = store.getState()
      if (!connecting && !connected) {
        socket.connect()
        store.setState({
          connecting: true,
          error: null
        })
      }
    },
    disconnect: () => {
      socket.disconnect()
    },
    subscribe: store.subscribe,
    destroy: () => {
      store.destroy()
      socket.disconnect()
      yDoc.off('update', handleYDocUpdate)
      awareness.off('update', handleAwarenessUpdate)
    }
  }
}
