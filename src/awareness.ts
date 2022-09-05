import type { Awareness } from 'y-protocols/awareness'

export type AwarenessChanges = Record<'added' | 'updated' | 'removed', number[]>

export const getClients = (awareness: Awareness): number[] => [...awareness.getStates().keys()]

export const getOtherClients = (awareness: Awareness): number[] => {
  const clients = getClients(awareness)
  return clients.filter((clientId) => clientId !== awareness.clientID)
}
