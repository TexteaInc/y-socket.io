# @textea/y-socket.io

## Features

- [x] React Enhancement like `<Room/>`, `<SocketIOProvider/>`...
- [x] Multi Persistence Support.
- [x] Customizable for each side.
- [ ] Authentication

## Usage

```shell
npm install @textea/y-socket.io
# or
yarn add @textea/y-socket.io
# or
pnpm install @textea/y-socket.io
```

```ts
import * as Y from 'yjs'
import { createSocketIOProvider } from '@textea/y-socket.io/provider'
const doc = new Y.Doc()

const provider = createSocketIOProvider('ws://localhost:1234', 'my-room', doc)
provider.subscribe(state => state.error, error => {
  if (error) {
    console.error('socket.io provider error', error)
  }
})
```

[View example code with React.js](example/src/App.tsx)

## Document

- [Sync Protocol](docs/sync.md)

## LICENSE

This project is [MIT](LICENSE) licensed.
