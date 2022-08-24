import type { Persistence } from '@textea/persistence'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as map from 'lib0/map'
import * as mutex from 'lib0/mutex'
import { debounce } from 'lodash'
import type { WebSocket } from 'ws'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'

import { callbackHandler, isCallbackSet } from './callback'

const CALLBACK_DEBOUNCE_WAIT = +(process.env.CALLBACK_DEBOUNCE_WAIT ??
  2000)
const CALLBACK_DEBOUNCE_MAXWAIT = +(process.env.CALLBACK_DEBOUNCE_MAXWAIT ??
  10000)

const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1
const wsReadyStateClosing = 2
const wsReadyStateClosed = 3

// disable gc when using snapshots!
const gcEnabled = process.env.GC !== 'false' && process.env.GC !== '0'
const persistenceDir = process.env.YPERSISTENCE

const docs = new Map<string, WSSharedDoc>()
export {
  docs
}

const messageSync = 0
const messageAwareness = 1
// const messageAuth = 2

const closeConnection = (
  doc: WSSharedDoc,
  ws: WebSocket
) => {
  if (doc.connections.has(ws)) {
    const persistence = ws.persistence
    const controlledIds: Set<number> = doc.connections.get(ws)!
    doc.connections.delete(ws)
    awarenessProtocol.removeAwarenessStates(doc.awareness,
      Array.from(controlledIds), null)
    if (doc.connections.size === 0 && persistence !== null) {
      // if persisted, we store state and destroy yDoc
      persistence.writeState(doc.name, doc).then(() => {
        doc.destroy()
      })
      docs.delete(doc.name)
    }
  }
  ws.close()
}

const send = (doc: WSSharedDoc, ws: WebSocket, m: Uint8Array) => {
  if (ws.readyState !== wsReadyStateConnecting && ws.readyState !==
    wsReadyStateOpen) {
    closeConnection(doc, ws)
  }
  try {
    ws.send(m,
      (err: any) => { err != null && closeConnection(doc, ws) })
  } catch (e) {
    closeConnection(doc, ws)
  }
}

const updateHandler = (update: Uint8Array, origin: any, doc: WSSharedDoc) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageSync)
  syncProtocol.writeUpdate(encoder, update)
  const message = encoding.toUint8Array(encoder)
  doc.connections.forEach((_, conn) => send(doc, conn, message))
}

export class WSSharedDoc extends Y.Doc {
  name: string
  mux: mutex.mutex
  connections: Map<WebSocket, Set<number>>
  awareness: awarenessProtocol.Awareness

  constructor (name: string) {
    super({ gc: gcEnabled })
    this.name = name
    this.mux = mutex.createMutex()
    this.connections = new Map()
    this.awareness = new awarenessProtocol.Awareness(this)
    this.awareness.setLocalState(null)
    const awarenessChangeHandler = ({ added, updated, removed }: {
        added: number[]
        updated: number[]
        removed: number[]
      }, conn: WebSocket | null
    ) => {
      const changedClients = added.concat(updated, removed)
      if (conn !== null) {
        const connControlledIDs = (this.connections.get(conn))
        if (connControlledIDs !== undefined) {
          added.forEach(clientID => { connControlledIDs.add(clientID) })
          removed.forEach(clientID => { connControlledIDs.delete(clientID) })
        }
      }
      // broadcast awareness update
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageAwareness)
      encoding.writeVarUint8Array(encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients))
      const buff = encoding.toUint8Array(encoder)
      this.connections.forEach((_, c) => {
        send(this, c, buff)
      })
    }
    this.awareness.on('update', awarenessChangeHandler)
    this.on('update', updateHandler)
    if (isCallbackSet) {
      this.on('update', debounce(
        callbackHandler,
        CALLBACK_DEBOUNCE_WAIT,
        { maxWait: CALLBACK_DEBOUNCE_MAXWAIT }
      ))
    }
  }
}

export const getYDoc = (
  docName: string,
  gc: boolean = true,
  persistence: Persistence
): WSSharedDoc =>
  map.setIfUndefined(docs,
    docName,
    () => {
      const doc = new WSSharedDoc(docName)
      doc.gc = gc
      persistence.bindState(docName, doc)
      docs.set(docName, doc)
      return doc
    })

const messageListener = (conn: any, doc: WSSharedDoc, message: Uint8Array) => {
  try {
    const encoder = encoding.createEncoder()
    const decoder = decoding.createDecoder(message)
    const messageType = decoding.readVarUint(decoder)
    switch (messageType) {
      case messageSync:
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.readSyncMessage(decoder, encoder, doc, null)
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder))
        }
        break
      case messageAwareness: {
        awarenessProtocol.applyAwarenessUpdate(doc.awareness,
          decoding.readVarUint8Array(decoder), conn)
        break
      }
    }
  } catch (err) {
    console.error(err)
    doc.emit('error', [err])
  }
}

const pingTimeout = 30000

type ConnectionOptions = {
  docName?: string
  gc?: boolean
}

export const setupWSConnection = (
  ws: WebSocket
) => {
  const docName = '1'
  const gc = true
  // todo
  const persistence = ws.persistence
  ws.binaryType = 'arraybuffer'
  // get doc, initialize if it does not exist yet
  const doc = getYDoc(docName, gc, persistence)
  doc.connections.set(ws, new Set())
  // listen and reply to events
  ws.on('message',
    (message: ArrayBuffer) => messageListener(ws, doc, new Uint8Array(message)))

  // Check if connection is still alive
  let pongReceived = true
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.connections.has(ws)) {
        closeConnection(doc, ws)
      }
      clearInterval(pingInterval)
    } else if (doc.connections.has(ws)) {
      pongReceived = false
      try {
        ws.ping()
      } catch (e) {
        closeConnection(doc, ws)
        clearInterval(pingInterval)
      }
    }
  }, pingTimeout)
  ws.on('close', () => {
    closeConnection(doc, ws)
    clearInterval(pingInterval)
  })
  ws.on('pong', () => {
    pongReceived = true
  })
  // put the following in a variables in a block so the interval handlers don't keep in in
  // scope
  // send sync step 1
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageSync)
  syncProtocol.writeSyncStep1(encoder, doc)
  send(doc, ws, encoding.toUint8Array(encoder))
  const awarenessStates = doc.awareness.getStates()
  if (awarenessStates.size > 0) {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageAwareness)
    encoding.writeVarUint8Array(encoder,
      awarenessProtocol.encodeAwarenessUpdate(doc.awareness,
        Array.from(awarenessStates.keys())))
    send(doc, ws, encoding.toUint8Array(encoder))
  }
}
