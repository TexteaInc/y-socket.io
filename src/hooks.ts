import { useDebugValue } from 'react'
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector'

import { INITIAL_STATE, SocketIOProvider, SocketIOProviderState } from './provider'

const getInitialState = () => INITIAL_STATE
const noop = () => {}

export function useSocketIOProviderState (provider: SocketIOProvider | undefined): SocketIOProviderState

export function useSocketIOProviderState<StateSlice> (
  provider: SocketIOProvider | undefined,
  selector: (state: SocketIOProviderState) => StateSlice,
  equalityFn?: (a: StateSlice, b: StateSlice) => boolean
): StateSlice

export function useSocketIOProviderState<StateSlice> (
  provider: SocketIOProvider | undefined,
  selector?: (state: SocketIOProviderState) => StateSlice | SocketIOProviderState,
  equalityFn?: (a: StateSlice | SocketIOProviderState, b: StateSlice | SocketIOProviderState) => boolean
) {
  const { getState = getInitialState, subscribe = () => noop } = provider ?? {}
  const selectState = selector ?? getState
  const selectedState = useSyncExternalStoreWithSelector(
    subscribe,
    getState,
    getInitialState,
    selectState,
    equalityFn
  )
  useDebugValue(selectedState)
  return selectedState
}
