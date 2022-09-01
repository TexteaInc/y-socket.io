import { io, Socket } from 'socket.io-client'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { createStore, Mutate, StoreApi } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

import type {
  AwarenessChanges,
  BroadcastChannelMessageEvent,
  ClientToServerEvents,
  ServerToClientEvents,
  TypedBroadcastChannel
} from './types'

export interface Options {
  awareness?: Awareness
  /**
   * @default false
   */
  autoConnect?: boolean
  /**
   * @default false
   */
  autoConnectBroadcastChannel?: boolean
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
  connectBroadcastChannel: () => void
  disconnectBroadcastChannel: () => void
}

type CreateSocketIOProvider = (
  serverUrl: string,
  roomName: string,
  doc: Y.Doc,
  options?: Options
) => SocketIOProvider

export const createSocketIOProvider: CreateSocketIOProvider = (
  serverUrl,
  roomName,
  doc,
  {
    awareness = new Awareness(doc),
    autoConnect = false,
    autoConnectBroadcastChannel = false
  } = {}
) => {
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
    const docDiff = Y.encodeStateVector(doc)
    socket.emit('doc:diff', roomName, docDiff)
    if (awareness.getLocalState() !== null) {
      const awarenessUpdate = encodeAwarenessUpdate(awareness, [doc.clientID])
      socket.emit('awareness:update', roomName, awarenessUpdate)
    }
    store.setState({
      connecting: false,
      connected: true,
      error: null
    })
  })
  socket.on('doc:diff', (diff) => {
    const updateV2 = Y.encodeStateAsUpdateV2(doc, new Uint8Array(diff))
    socket.emit('doc:update', roomName, updateV2)
  })
  socket.on('doc:update', (update) => {
    Y.applyUpdateV2(doc, new Uint8Array(update), socket)
    store.setState({ synced: true })
  })
  socket.on('awareness:update', (update) => {
    applyAwarenessUpdate(awareness, new Uint8Array(update), socket)
  })
  socket.on('disconnect', (_reason, description) => {
    const clients = [...awareness.getStates().keys()].filter(
      (clientId) => clientId !== doc.clientID
    )
    removeAwarenessStates(awareness, clients, socket)
    const err = description instanceof Error ? description.message : null
    store.setState({
      connecting: false,
      connected: false,
      error: err
    })
  })

  const broadcastChannelName = new URL(roomName, serverUrl).toString()
  const broadcastChannel: TypedBroadcastChannel = new BroadcastChannel(broadcastChannelName)
  const handleBroadcastChannelMessage = (event: BroadcastChannelMessageEvent) => {
    const [eventName] = event.data
    switch (eventName) {
      case 'doc:diff': {
        const [, diff, clientId] = event.data
        const updateV2 = Y.encodeStateAsUpdateV2(doc, diff)
        broadcastChannel.postMessage(['doc:update', updateV2, clientId])
        break
      }
      case 'doc:update': {
        const [, update, clientId] = event.data
        if (!clientId || clientId === doc.clientID) {
          Y.applyUpdateV2(doc, update, socket)
        }
        break
      }
      case 'awareness:query': {
        const [, clientId] = event.data
        const clients = [...awareness.getStates().keys()]
        const update = encodeAwarenessUpdate(awareness, clients)
        broadcastChannel.postMessage(['awareness:update', update, clientId])
        break
      }
      case 'awareness:update': {
        const [, update, clientId] = event.data
        if (!clientId || clientId === doc.clientID) {
          applyAwarenessUpdate(awareness, update, socket)
        }
        break
      }
    }
  }
  const connectBroadcastChannel = () => {
    if (broadcastChannel.onmessage !== null) {
      return
    }
    broadcastChannel.onmessage = handleBroadcastChannelMessage
    const docDiff = Y.encodeStateVector(doc)
    broadcastChannel.postMessage(['doc:diff', docDiff, doc.clientID])
    const docUpdate = Y.encodeStateAsUpdateV2(doc)
    broadcastChannel.postMessage(['doc:update', docUpdate])
    broadcastChannel.postMessage(['awareness:query', doc.clientID])
    if (awareness.getLocalState() !== null) {
      const awarenessUpdate = encodeAwarenessUpdate(awareness, [doc.clientID])
      broadcastChannel.postMessage(['awareness:update', awarenessUpdate])
    }
  }
  const disconnectBroadcastChannel = () => {
    broadcastChannel.onmessage = null
  }
  if (autoConnectBroadcastChannel) {
    connectBroadcastChannel()
  }

  const handleDocUpdate = (update: Uint8Array, origin: null | Socket) => {
    if (origin !== socket) {
      const updateV2 = Y.convertUpdateFormatV1ToV2(update)
      socket.emit('doc:update', roomName, updateV2, () => {
        store.setState({ synced: true })
      })
      store.setState({ synced: false })
      broadcastChannel.postMessage(['doc:update', updateV2])
    }
  }
  doc.on('update', handleDocUpdate)

  const handleAwarenessUpdate = (changes: AwarenessChanges, origin: string | Socket) => {
    if (origin !== socket) {
      const changedClients = Object.values(changes).reduce((res, cur) => [...res, ...cur])
      const update = encodeAwarenessUpdate(awareness, changedClients)
      socket.emit('awareness:update', roomName, update)
      broadcastChannel.postMessage(['awareness:update', update])
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
    connectBroadcastChannel,
    disconnectBroadcastChannel,
    subscribe: store.subscribe,
    destroy: () => {
      store.destroy()
      socket.disconnect()
      broadcastChannel.close()
      doc.off('update', handleDocUpdate)
      awareness.off('update', handleAwarenessUpdate)
    }
  }
}
