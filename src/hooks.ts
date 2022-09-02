import { useDebugValue } from 'react'
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector'

import { INITIAL_STATE, SocketIOProvider, SocketIOProviderState } from './provider'

const getInitialState = () => INITIAL_STATE

const noop = () => noop
const identity = <T>(value: T) => value

export function useSocketIOProviderState (provider: SocketIOProvider | null | undefined): SocketIOProviderState

export function useSocketIOProviderState<StateSlice> (
  provider: SocketIOProvider | null | undefined,
  selector: (state: SocketIOProviderState) => StateSlice,
  equalityFn?: (a: StateSlice, b: StateSlice) => boolean
): StateSlice

export function useSocketIOProviderState<StateSlice> (
  provider: SocketIOProvider | null | undefined,
  selector: (state: SocketIOProviderState) => StateSlice | SocketIOProviderState = identity,
  equalityFn?: (a: StateSlice | SocketIOProviderState, b: StateSlice | SocketIOProviderState) => boolean
) {
  const { getState = getInitialState, subscribe = noop } = provider ?? {}
  const selectedState = useSyncExternalStoreWithSelector(
    subscribe,
    getState,
    getInitialState,
    selector,
    equalityFn
  )
  useDebugValue(selectedState)
  return selectedState
}
