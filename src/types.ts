import type { Room } from 'socket.io-adapter'
import type { Awareness } from 'y-protocols/awareness'

export type RoomName = Room
export type ClientId = Awareness['clientID']

export type DefaultClientData = {}

export interface QueryParameters {
  [key: string]: string | string[] | undefined
  roomName: string
  clientId: string
}
