import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'

import type { RoomName } from '../../types'

export interface Room {
  doc: Y.Doc
  awareness: Awareness
}

type RoomMap = Map<RoomName, Promise<Room>>

export const createRoomMap = () => {
  return new Proxy<RoomMap>(new Map(), {
    get (target, property, receiver) {
      if (property === 'get') {
        return (roomName: RoomName) => {
          const loadingRoom = target.get(roomName)
          if (!loadingRoom) {
            console.error(new TypeError(`room '${roomName}' is null`))
          }
          return loadingRoom
        }
      } else {
        const value = Reflect.get(target, property, receiver)
        if (typeof value === 'function') {
          return value.bind(target)
        } else {
          return value
        }
      }
    }
  })
}
