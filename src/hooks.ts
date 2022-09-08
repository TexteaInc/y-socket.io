import { useDebugValue } from 'react'
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector'

import { INITIAL_STATE, SocketIOProvider, SocketIOProviderState } from './provider'
import type { DefaultClientData } from './types'

const getInitialState = () => INITIAL_STATE

const noop = () => noop
const identity = <T>(value: T) => value

export function useSocketIOProviderState <ClientData extends DefaultClientData>(
  provider: SocketIOProvider<ClientData> | null | undefined
): SocketIOProviderState<ClientData>

export function useSocketIOProviderState<ClientData extends DefaultClientData, StateSlice> (
  provider: SocketIOProvider<ClientData> | null | undefined,
  selector: (state: SocketIOProviderState<ClientData>) => StateSlice,
  equalityFn?: (a: StateSlice, b: StateSlice) => boolean
): StateSlice

export function useSocketIOProviderState<ClientData extends DefaultClientData, StateSlice> (
  provider: SocketIOProvider<ClientData> | null | undefined,
  selector: (state: SocketIOProviderState<ClientData>) => StateSlice | SocketIOProviderState<ClientData> = identity,
  equalityFn?: (
    a: StateSlice | SocketIOProviderState<ClientData>,
    b: StateSlice | SocketIOProviderState<ClientData>
  ) => boolean
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
