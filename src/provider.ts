import { io, Socket } from 'socket.io-client'
import { v4 as uuid } from 'uuid'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { createStore, Mutate, StoreApi } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

import { AwarenessChanges, getClients, getOtherClients } from './awareness'
import type {
  BroadcastChannelMessageData,
  BroadcastChannelMessageEvent,
  ClientToServerEvents,
  ServerToClientEvents
} from './events'
import type { RoomName } from './types'

export interface Options {
  awareness?: Awareness
  /**
   * @default true
   */
  autoConnect?: boolean
  /**
   * @default true
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
  roomName: RoomName,
  doc: Y.Doc,
  options?: Options
) => SocketIOProvider

export const createSocketIOProvider: CreateSocketIOProvider = (
  serverUrl,
  roomName,
  doc,
  {
    awareness = new Awareness(doc),
    autoConnect = true,
    autoConnectBroadcastChannel = true
  } = {}
) => {
  type DocUpdateId = string
  const syncingDocUpdates = new Set<DocUpdateId>()

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
    socket.once('doc:update', () => {
      if (!syncingDocUpdates.size) {
        store.setState({ synced: true })
      }
    })
    if (awareness.getLocalState() !== null) {
      const awarenessUpdate = encodeAwarenessUpdate(awareness, [awareness.clientID])
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
  socket.on('doc:update', (updateV2) => {
    Y.applyUpdateV2(doc, new Uint8Array(updateV2), socket)
  })
  socket.on('awareness:update', (update) => {
    applyAwarenessUpdate(awareness, new Uint8Array(update), socket)
  })
  socket.on('disconnect', (_reason, description) => {
    const err = description instanceof Error ? description : null
    const otherClients = getOtherClients(awareness)
    removeAwarenessStates(awareness, otherClients, socket)
    syncingDocUpdates.clear()
    store.setState({
      ...INITIAL_STATE,
      error: err?.message
    })
  })

  interface TypedBroadcastChannel extends BroadcastChannel {
    onmessage: ((event: BroadcastChannelMessageEvent) => void) | null
    postMessage: (message: BroadcastChannelMessageData) => void
  }

  let broadcastChannel: TypedBroadcastChannel | undefined
  const broadcastChannelName = new URL(roomName, serverUrl).toString()
  const handleBroadcastChannelMessage = (event: BroadcastChannelMessageEvent) => {
    const [eventName] = event.data
    switch (eventName) {
      case 'doc:diff': {
        const [, diff, clientId] = event.data
        const updateV2 = Y.encodeStateAsUpdateV2(doc, diff)
        broadcastChannel!.postMessage(['doc:update', updateV2, clientId])
        break
      }
      case 'doc:update': {
        const [, updateV2, clientId] = event.data
        if (!clientId || clientId === awareness.clientID) {
          Y.applyUpdateV2(doc, updateV2, socket)
        }
        break
      }
      case 'awareness:query': {
        const [, clientId] = event.data
        const clients = getClients(awareness)
        const update = encodeAwarenessUpdate(awareness, clients)
        broadcastChannel!.postMessage(['awareness:update', update, clientId])
        break
      }
      case 'awareness:update': {
        const [, update, clientId] = event.data
        if (!clientId || clientId === awareness.clientID) {
          applyAwarenessUpdate(awareness, update, socket)
        }
        break
      }
    }
  }
  const connectBroadcastChannel = () => {
    if (broadcastChannel) {
      return
    }
    broadcastChannel = new BroadcastChannel(broadcastChannelName)
    broadcastChannel.onmessage = handleBroadcastChannelMessage
    const docDiff = Y.encodeStateVector(doc)
    broadcastChannel.postMessage(['doc:diff', docDiff, awareness.clientID])
    const docUpdateV2 = Y.encodeStateAsUpdateV2(doc)
    broadcastChannel.postMessage(['doc:update', docUpdateV2])
    broadcastChannel.postMessage(['awareness:query', awareness.clientID])
    if (awareness.getLocalState() !== null) {
      const awarenessUpdate = encodeAwarenessUpdate(awareness, [awareness.clientID])
      broadcastChannel.postMessage(['awareness:update', awarenessUpdate])
    }
  }
  const disconnectBroadcastChannel = () => {
    if (broadcastChannel) {
      broadcastChannel.close()
      broadcastChannel = undefined
    }
  }
  if (autoConnectBroadcastChannel) {
    connectBroadcastChannel()
  }

  const shouldSyncUpdate = () => socket.connected || broadcastChannel

  const handleDocUpdate = (updateV1: Uint8Array, origin: null | Socket) => {
    if (origin === socket || !shouldSyncUpdate()) {
      return
    }
    const updateV2 = Y.convertUpdateFormatV1ToV2(updateV1)
    if (socket.connected) {
      const updateId = uuid()
      syncingDocUpdates.add(updateId)
      store.setState({ synced: false })
      socket.emit('doc:update', roomName, updateV2, () => {
        syncingDocUpdates.delete(updateId)
        if (!syncingDocUpdates.size) {
          store.setState({ synced: true })
        }
      })
    }
    broadcastChannel?.postMessage(['doc:update', updateV2])
  }
  doc.on('update', handleDocUpdate)

  const handleAwarenessUpdate = (changes: AwarenessChanges, origin: string | Socket) => {
    if (origin === socket || !shouldSyncUpdate()) {
      return
    }
    const changedClients = Object.values(changes).reduce((res, cur) => [...res, ...cur])
    const update = encodeAwarenessUpdate(awareness, changedClients)
    socket.volatile.emit('awareness:update', roomName, update)
    broadcastChannel?.postMessage(['awareness:update', update])
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
      broadcastChannel?.close()
      doc.off('update', handleDocUpdate)
      awareness.off('update', handleAwarenessUpdate)
    }
  }
}
