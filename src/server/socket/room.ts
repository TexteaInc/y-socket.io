import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'

import type { RoomName } from '../../types'
import type { UserId } from './user'

export interface Room {
  owner: UserId
  awareness: Awareness
  getDoc: () => Promise<Y.Doc>
  destroy: () => Promise<void>
}

export type RoomMap = Map<RoomName, Room>
