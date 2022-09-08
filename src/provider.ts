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
import type { DefaultClientData, QueryParameters, RoomName } from './types'

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

interface SocketState {
  connecting: boolean
  connected: boolean
  synced: boolean
  error: string | null
}

const INITIAL_SOCKET_STATE: Readonly<SocketState> = {
  connecting: false,
  connected: false,
  synced: false,
  error: null
}

export interface SocketIOProviderState<ClientData extends DefaultClientData = DefaultClientData> extends SocketState {
  data: ClientData | null
}

/**
 * @internal
 */
export const INITIAL_STATE: Readonly<SocketIOProviderState<any>> = {
  ...INITIAL_SOCKET_STATE,
  data: null
}

type ReadonlyStore<Store extends StoreApi<unknown>> = Omit<Store, 'setState'>

type SocketIOProviderStore<ClientData extends DefaultClientData> = ReadonlyStore<
  Mutate<StoreApi<SocketIOProviderState<ClientData>>, [['zustand/subscribeWithSelector', never]]>
>

export interface SocketIOProvider<ClientData extends DefaultClientData = DefaultClientData>
  extends SocketIOProviderStore<ClientData> {
  connect: () => void
  disconnect: () => void
  connectBroadcastChannel: () => void
  disconnectBroadcastChannel: () => void
}

type CreateSocketIOProvider = <ClientData extends DefaultClientData>(
  serverUrl: string,
  roomName: RoomName,
  doc: Y.Doc,
  options?: Options
) => SocketIOProvider<ClientData>

export const createSocketIOProvider: CreateSocketIOProvider = <ClientData extends DefaultClientData>(
  serverUrl: string,
  roomName: RoomName,
  doc: Y.Doc,
  {
    awareness = new Awareness(doc),
    autoConnect = true,
    autoConnectBroadcastChannel = true
  }: Options = {}
) => {
  type DocUpdateId = string
  const syncingDocUpdates = new Set<DocUpdateId>()

  const store = createStore<SocketIOProviderState<ClientData>>()(
    subscribeWithSelector(() => ({
      ...INITIAL_STATE,
      connecting: autoConnect
    }))
  )

  const queryParameters: QueryParameters = {
    roomName,
    clientId: String(awareness.clientID)
  }
  const socket: Socket<ServerToClientEvents<ClientData>, ClientToServerEvents> = io(serverUrl, {
    query: queryParameters,
    autoConnect
  })

  socket.on('connect_error', (err) => {
    store.setState({
      connecting: false,
      error: err.message
    })
  })
  socket.on('connect', () => {
    store.setState({
      connecting: false,
      connected: true,
      error: null
    })
    const docDiff = Y.encodeStateVector(doc)
    socket.emit('doc:diff', docDiff)
    socket.once('doc:update', () => {
      if (!syncingDocUpdates.size) {
        store.setState({ synced: true })
      }
    })
    const awarenessUpdate = encodeAwarenessUpdate(awareness, [awareness.clientID])
    socket.emit('awareness:update', awarenessUpdate)
  })
  socket.on('data:update', (data) => {
    store.setState({ data })
  })
  socket.on('doc:diff', (diff) => {
    const updateV2 = Y.encodeStateAsUpdateV2(doc, new Uint8Array(diff))
    socket.emit('doc:update', updateV2)
  })
  socket.on('doc:update', (updateV2) => {
    Y.applyUpdateV2(doc, new Uint8Array(updateV2), socket)
  })
  socket.on('awareness:update', (update) => {
    applyAwarenessUpdate(awareness, new Uint8Array(update), socket)
  })
  socket.on('disconnect', (_reason, description) => {
    const err = description instanceof Error ? description : null
    syncingDocUpdates.clear()
    store.setState({
      ...INITIAL_STATE,
      error: err?.message
    })
    const otherClients = getOtherClients(awareness)
    removeAwarenessStates(awareness, otherClients, socket)
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
    broadcastChannel = Object.assign(new BroadcastChannel(broadcastChannelName), {
      onmessage: handleBroadcastChannelMessage
    })
    const docDiff = Y.encodeStateVector(doc)
    broadcastChannel.postMessage(['doc:diff', docDiff, awareness.clientID])
    const docUpdateV2 = Y.encodeStateAsUpdateV2(doc)
    broadcastChannel.postMessage(['doc:update', docUpdateV2])
    broadcastChannel.postMessage(['awareness:query', awareness.clientID])
    const awarenessUpdate = encodeAwarenessUpdate(awareness, [awareness.clientID])
    broadcastChannel.postMessage(['awareness:update', awarenessUpdate])
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
      socket.emit('doc:update', updateV2, () => {
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
    socket.volatile.emit('awareness:update', update)
    broadcastChannel?.postMessage(['awareness:update', update])
  }
  awareness.on('update', handleAwarenessUpdate)

  return {
    getState: store.getState,
    connect: () => {
      const { connecting, connected } = store.getState()
      if (!connecting && !connected) {
        store.setState({
          connecting: true,
          error: null
        })
        socket.connect()
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
