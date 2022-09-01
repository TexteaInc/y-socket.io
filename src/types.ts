export type AwarenessChanges = Record<'added' | 'updated' | 'removed', number[]>

export interface ServerToClientEvents {
  'doc:diff': (diff: ArrayBuffer) => void
  'doc:update': (update: ArrayBuffer) => void
  'awareness:update': (update: ArrayBuffer) => void
}

export interface ClientToServerEvents {
  join: (roomName: string) => void

  'doc:diff': (roomName: string, diff: Uint8Array) => void
  'doc:update': (roomName: string, update: Uint8Array, callback?: () => void) => void
  'awareness:update': (roomName: string, update: Uint8Array) => void
}

type ClientToServerEventNames = keyof ClientToServerEvents

type BroadcastChannelMessageData<EventName extends ClientToServerEventNames = ClientToServerEventNames> =
  | EventName extends `${'doc' | 'awareness'}:${string}`
      ? [eventName: EventName, payload: Uint8Array, clientId?: number]
      : never
  | [eventName: 'awareness:query', clientId: number]

export type BroadcastChannelMessageEvent = MessageEvent<BroadcastChannelMessageData>

export interface TypedBroadcastChannel extends BroadcastChannel {
  onmessage: ((event: BroadcastChannelMessageEvent) => void) | null
  postMessage: (message: BroadcastChannelMessageData) => void
}
