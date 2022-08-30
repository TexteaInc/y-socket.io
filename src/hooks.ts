import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector'
import shallow from 'zustand/shallow'

import type { SocketIOProvider, SocketIOProviderState } from './provider'
import { INITIAL_STATE } from './provider'

const getInitialState = () => INITIAL_STATE
const noop = () => {}

export function useSocketIOProviderState (provider: SocketIOProvider | undefined): SocketIOProviderState
export function useSocketIOProviderState<StateSlice> (
  provider: SocketIOProvider | undefined,
  selector: (state: SocketIOProviderState) => StateSlice
): StateSlice
export function useSocketIOProviderState<StateSlice> (
  provider: SocketIOProvider | undefined,
  selector?: ((state: SocketIOProviderState) => StateSlice | SocketIOProviderState)
) {
  const { getState = getInitialState, subscribe = () => noop } = provider ?? {}
  const selectState = selector ?? getState
  return useSyncExternalStoreWithSelector(
    subscribe,
    getState,
    getInitialState,
    selectState,
    shallow
  )
}
