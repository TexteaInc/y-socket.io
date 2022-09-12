import 'remirror/styles/all.css'

import { YjsExtension } from '@remirror/extension-yjs'
import { Remirror, useRemirror } from '@remirror/react'
import { useSocketIOProviderState } from '@textea/y-socket.io/hooks'
import {
  createSocketIOProvider,
  SocketIOProvider
} from '@textea/y-socket.io/provider'
import React, { useDeferredValue, useEffect, useState } from 'react'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { ClientData } from './types'

const yDoc = new Y.Doc()
const roomId = 'test-id'

const awareness = new Awareness(yDoc)

type User = {
  id: Awareness['clientID']
  name: string
}

const DEFAULT_USER: Readonly<User> = {
  id: awareness.clientID,
  name: `ID_${awareness.clientID.toString(16).toUpperCase()}`
}
awareness.setLocalState(DEFAULT_USER)

export const App: React.FC = () => {
  const [userName, setUserName] = useState(DEFAULT_USER.name)
  const [otherUsers, setOtherUsers] = useState<User[]>([])

  const [provider, setProvider] = useState<SocketIOProvider<ClientData>>()
  const { manager } = useRemirror({
    extensions: () => [
      new YjsExtension({
        getProvider: () => ({
          doc: yDoc,
          awareness,
          destroy: () => provider?.destroy(),
          disconnect: () => provider?.disconnect()
        })
      })
    ],
    core: {
      excludeExtensions: ['history']
    }
  })

  const isConnecting = useSocketIOProviderState(provider,
    (state) => state.connecting)
  const isConnected = useSocketIOProviderState(provider,
    (state) => state.connected)
  const isSynced = useSocketIOProviderState(provider, (state) => state.synced)

  const deferredIsSynced = useDeferredValue(isSynced)

  const status = isConnecting
    ? 'Connecting'
    : isConnected
      ? deferredIsSynced
        ? 'Synced'
        : 'Syncing'
      : 'Disconnected'

  const clientData = useSocketIOProviderState(provider, (state) => state.data)

  const role = isConnected
    ? clientData
      ? clientData.isOwner
        ? 'Admin'
        : 'User'
      : 'Loading...'
    : 'Not Available'

  useEffect(() => {
    const handleAwarenessUpdate = () => {
      const localUser = awareness.getLocalState() as User | null
      if (localUser) {
        setUserName(localUser.name)
      }
      setOtherUsers(
        [...awareness.getStates().entries()].filter(
          ([clientId]) => clientId !== yDoc.clientID)
          .map(([, state]) => state as User)
      )
    }
    awareness.on('update', handleAwarenessUpdate)
    const provider = createSocketIOProvider<ClientData>('ws://localhost:1234',
      roomId, yDoc, {
        awareness,
        autoConnect: false
      })
    setProvider(provider)
    return () => {
      awareness.off('update', handleAwarenessUpdate)
      provider.destroy()
    }
  }, [])

  if (!provider) {
    return <p>Loading...</p>
  }

  return (
    <>
      <p>
        <button
          onClick={() => {
            if (isConnected) {
              provider.disconnect()
            } else {
              provider.connect()
            }
          }}
        >
          {isConnected ? 'Disconnect' : 'Connect'}
        </button>
        {role === 'Admin' && (
          <>
            <span>{' '}</span>
            <button onClick={provider.closeRoom}>
              Close Room
            </button>
          </>
        )}
      </p>
      <p>Status: {status}</p>
      <p>Role: {role}</p>
      <div className='remirror-theme'>
        <Remirror manager={manager}/>
      </div>
      <p>
        <label htmlFor='name'>Name: </label>
        <input
          id='name'
          value={userName}
          onChange={(event) => {
            awareness.setLocalStateField('name', event.target.value)
          }}
        />
      </p>
      {otherUsers.length > 0 && (
        <div>
          <div>Users:</div>
          <ul>
            {otherUsers.map((user) => (
              <li key={user.id}>{user.name}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

export default App
