import type * as Y from 'yjs'

export interface Persistence {
  bindState: (roomName: string, doc: Y.Doc) => Promise<void>
  writeState: (roomName: string, doc: Y.Doc) => Promise<void>
}
