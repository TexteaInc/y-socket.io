import type { ClientId, DefaultClientData } from './types'

type EventHandler = (...args: any[]) => void
export type DefaultEvents = {
  [eventName: string]: EventHandler
}

type EventNameWithScope<Scope extends string, Type extends string = string> = `${Scope}:${Type}`

type DataScope = 'data'
type RoomScope = 'room'

type YDocScope = 'doc'
type AwarenessScope = 'awareness'
type ObservableScope = YDocScope | AwarenessScope
type ObservableEventName = EventNameWithScope<ObservableScope>

type ValidEventScope = DataScope | RoomScope | ObservableScope

type ValidateEvents<
  Events extends DefaultEvents & {
    [EventName in keyof Events]: EventName extends EventNameWithScope<infer EventScope>
      ? EventScope extends ValidEventScope
        ? Events[EventName]
        : never
      : Events[EventName]
  }
> = Events

export type ServerToClientEvents<ClientData extends DefaultClientData = DefaultClientData> = ValidateEvents<{
  ['data:update']: (data: ClientData) => void
  ['doc:diff']: (diff: ArrayBuffer) => void
  ['doc:update']: (updateV2: ArrayBuffer) => void
  ['awareness:update']: (update: ArrayBuffer) => void
}>

export type ClientToServerEvents = ValidateEvents<{
  ['room:close']: () => void
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
