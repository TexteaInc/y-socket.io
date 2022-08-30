export type AwarenessChanges = Record<'added' | 'updated' | 'removed', number[]>

export interface ServerToClientEvents {
  'yDoc:diff': (diff: ArrayBuffer) => void
  'yDoc:update': (update: ArrayBuffer) => void
  'awareness:update': (update: ArrayBuffer) => void
}

export interface ClientToServerEvents {
  join: (roomName: string) => void

  'yDoc:diff': (roomName: string, diff: Uint8Array) => void
  'yDoc:update': (roomName: string, update: Uint8Array, callback?: () => void) => void
  'awareness:update': (roomName: string, update: Uint8Array) => void
}
