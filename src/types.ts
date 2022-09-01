export type AwarenessChanges = Record<'added' | 'updated' | 'removed', number[]>

type EventNameWithScope<Scope extends string, Type extends string = string> = `${Scope}:${Type}`

type YDocScope = 'doc'
type AwarenessScope = 'awareness'
type ObservableScope = YDocScope | AwarenessScope
type ObservableEventName = EventNameWithScope<ObservableScope>

type ValidEventScope = ObservableScope

type EventHandler = (...args: any[]) => void

type ValidateEvents<
  Events extends Record<string, EventHandler> & {
    [EventName in keyof Events]: EventName extends EventNameWithScope<infer EventScope>
      ? EventScope extends ValidEventScope
        ? Events[EventName]
        : never
      : Events[EventName]
  }
> = Events

export type ServerToClientEvents = ValidateEvents<{
  'doc:diff': (diff: ArrayBuffer) => void
  'doc:update': (updateV2: ArrayBuffer) => void
  'awareness:update': (update: ArrayBuffer) => void
}>

export type ClientToServerEvents = ValidateEvents<{
  join: (roomName: string) => void

  'doc:diff': (roomName: string, diff: Uint8Array) => void
  'doc:update': (roomName: string, updateV2: Uint8Array, callback?: () => void) => void
  'awareness:update': (roomName: string, update: Uint8Array) => void
}>

type ClientToServerEventNames = keyof ClientToServerEvents

type BroadcastChannelMessageData<EventName extends ClientToServerEventNames = ClientToServerEventNames> =
  | EventName extends ObservableEventName
      ? [eventName: EventName, payload: Uint8Array, clientId?: number]
      : never
  | [eventName: `${AwarenessScope}:query`, clientId: number]

export type BroadcastChannelMessageEvent = MessageEvent<BroadcastChannelMessageData>

export interface TypedBroadcastChannel extends BroadcastChannel {
  onmessage: ((event: BroadcastChannelMessageEvent) => void) | null
  postMessage: (message: BroadcastChannelMessageData) => void
}
