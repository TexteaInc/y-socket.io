import React, { useEffect, useRef, useState } from 'react'
import { Awareness } from 'y-protocols/awareness'
import { createSocketIOProvider, SocketIOProvider } from 'y-socket.io'
import * as Y from 'yjs'

const yDoc = new Y.Doc()
const yText = yDoc.getText()

type User = {
  id: number
  name: string
}

const DEFAULT_USER: Readonly<User> = {
  id: yDoc.clientID,
  name: `ID_${yDoc.clientID.toString(16).toUpperCase()}`
}

const awareness = new Awareness(yDoc)
awareness.setLocalState(DEFAULT_USER)

export const App: React.FC = () => {
  const [text, setText] = useState('')
  const [name, setName] = useState(DEFAULT_USER.name)
  const [others, setOthers] = useState<User[]>([])

  const providerRef = useRef<SocketIOProvider | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const yTextObserver = () => {
      setText(yText.toJSON())
    }
    yText.observe(yTextObserver)
    const handleAwarenessUpdate = () => {
      const self = awareness.getLocalState() as User | null
      if (self) {
        setName(self.name)
      }
      setOthers(
        [...awareness.getStates().entries()]
          .filter(([clientId]) => clientId !== yDoc.clientID)
          .map(([, state]) => state as User)
      )
    }
    awareness.on('update', handleAwarenessUpdate)
    const provider = createSocketIOProvider(
      'ws://localhost:1234',
      'test',
      yDoc,
      {
        autoConnect: true,
        awareness
      }
    )
    provider.subscribe((state) => state.connected, setConnected)
    providerRef.current = provider
    return () => {
      yText.unobserve(yTextObserver)
      awareness.off('update', handleAwarenessUpdate)
      provider.destroy()
    }
  }, [])

  return (
    <>
      <p>
        <button
          onClick={() => {
            if (connected) {
              providerRef.current?.disconnect()
            } else {
              providerRef.current?.connect()
            }
          }}
        >
          {connected ? 'Disconnect' : 'Connect'}
        </button>
      </p>
      <p>
        <label htmlFor='text'>Text: </label>
        <input
          id='text'
          value={text}
          onChange={(event) => {
            yDoc.transact(() => {
              yText.delete(0, yText.length)
              yText.insert(0, event.target.value)
            })
          }}
        />
      </p>
      <p>
        <label htmlFor='name'>Name: </label>
        <input
          id='name'
          value={name}
          onChange={(event) => {
            awareness.setLocalStateField('name', event.target.value)
          }}
        />
      </p>
      <div>
        <div>Users: </div>
        <ul>
          {others.map((user) => (
            <li key={user.id}>{user.name}</li>
          ))}
        </ul>
      </div>
    </>
  )
}

export default App
