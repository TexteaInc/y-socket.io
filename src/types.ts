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

type ClientToServerEventNames = keyof ClientToServerEvents

type BroadcastChannelMessageData<EventName extends ClientToServerEventNames = ClientToServerEventNames> =
  | EventName extends `${'yDoc' | 'awareness'}:${string}`
      ? [eventName: EventName, payload: Uint8Array, clientId?: number]
      : never
  | [eventName: 'awareness:query', clientId: number]

export type BroadcastChannelMessageEvent = MessageEvent<BroadcastChannelMessageData>

export interface TypedBroadcastChannel extends BroadcastChannel {
  onmessage: ((event: BroadcastChannelMessageEvent) => void) | null
  postMessage: (message: BroadcastChannelMessageData) => void
}
