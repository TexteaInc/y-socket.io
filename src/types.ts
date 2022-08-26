export interface ServerToClientEvents {
  'doc:diff': (diff: ArrayBuffer) => void
  'doc:update': (update: ArrayBuffer) => void
}

export interface ClientToServerEvents {
  join: (roomName: string) => void

  'doc:diff': (roomName: string, diff: Uint8Array) => void
  'doc:update': (roomName: string, update: Uint8Array) => void
}
