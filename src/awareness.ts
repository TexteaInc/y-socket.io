import type { Awareness } from 'y-protocols/awareness'

import type { ClientId } from './types'

export type AwarenessChanges = Record<'added' | 'updated' | 'removed', ClientId[]>

export const getClients = (awareness: Awareness): ClientId[] => [...awareness.getStates().keys()]

export const getOtherClients = (awareness: Awareness): ClientId[] => {
  const clients = getClients(awareness)
  return clients.filter((clientId) => clientId !== awareness.clientID)
}
