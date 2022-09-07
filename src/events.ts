import type { ClientId } from './types'

type EventHandler = (...args: any[]) => void
export type DefaultEvents = {
  [eventName: string]: EventHandler
}

type EventNameWithScope<Scope extends string, Type extends string = string> = `${Scope}:${Type}`

type YDocScope = 'doc'
type AwarenessScope = 'awareness'
type ObservableScope = YDocScope | AwarenessScope
type ObservableEventName = EventNameWithScope<ObservableScope>

type ValidEventScope = ObservableScope

type ValidateEvents<
  Events extends DefaultEvents & {
    [EventName in keyof Events]: EventName extends EventNameWithScope<infer EventScope>
      ? EventScope extends ValidEventScope
        ? Events[EventName]
        : never
      : Events[EventName]
  }
> = Events

export type ServerToClientEvents = ValidateEvents<{
  ['doc:diff']: (diff: ArrayBuffer) => void
  ['doc:update']: (updateV2: ArrayBuffer) => void
  ['awareness:update']: (update: ArrayBuffer) => void
}>

export type ClientToServerEvents = ValidateEvents<{
  ['doc:diff']: (diff: Uint8Array) => void
  ['doc:update']: (updateV2: Uint8Array, callback?: () => void) => void
  ['awareness:update']: (update: Uint8Array) => void
}>

type ClientToServerEventNames = keyof ClientToServerEvents

export type BroadcastChannelMessageData<EventName extends ClientToServerEventNames = ClientToServerEventNames> =
  | (EventName extends ObservableEventName
      ? [eventName: EventName, payload: Uint8Array, clientId?: ClientId]
      : never)
  | [eventName: `${AwarenessScope}:query`, clientId: ClientId]

export type BroadcastChannelMessageEvent = MessageEvent<BroadcastChannelMessageData>
