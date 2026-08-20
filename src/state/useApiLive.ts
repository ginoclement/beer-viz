import { useSyncExternalStore } from 'react'
import { isApiLive, subscribeApiLive } from '../lib/api'

/**
 * True while the beer-api should be used; flips to false for the session the
 * moment any request to it fails, re-rendering subscribed views so their data
 * effects re-run against the bundled fallback chunks.
 */
export function useApiLive(): boolean {
  return useSyncExternalStore(subscribeApiLive, isApiLive, isApiLive)
}
