import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'

import type { UserId } from './user'

export type GetDoc = () => Promise<Y.Doc>

export interface Room {
  owner: UserId
  getDoc: GetDoc
  awareness: Awareness
  destroy: () => Promise<void>
}
