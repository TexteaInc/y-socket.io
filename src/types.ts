import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'

export type AwarenessChanges = Record<'added' | 'updated' | 'removed', number[]>

export interface Room {
  yDoc: Y.Doc
  awareness: Awareness
}

export interface ServerToClientEvents {
  'doc:diff': (diff: ArrayBuffer) => void
  'doc:update': (update: ArrayBuffer) => void
  'awareness:update': (update: ArrayBuffer) => void
}

export interface ClientToServerEvents {
  join: (roomName: string) => void

  'doc:diff': (roomName: string, diff: Uint8Array) => void
  'doc:update': (roomName: string, update: Uint8Array) => void
  'awareness:update': (roomName: string, update: Uint8Array) => void
}
