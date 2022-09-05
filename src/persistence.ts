import type * as Y from 'yjs'

import type { RoomName } from './types'

export interface Persistence {
  bindState: (roomName: RoomName, doc: Y.Doc) => Promise<void>
  writeState: (roomName: RoomName, doc: Y.Doc) => Promise<void>
}
