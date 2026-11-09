/**
 * Covers what the app reads again once data changed in another tab or on another device
 *
 * These tests catch bank sync's views left out of that refresh, so a review decision, a sync, a link
 * or a connection made elsewhere leaves the review block, the pending strip, the sync status or the
 * connections as they were when the user comes back
 */
import { QueryClient, type QueryKey } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { invalidateAppData } from '@/api/cache/invalidation'
import { bankSyncKeys } from '@/api/cache/queryKeys'

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient()
})

afterEach(() => {
  queryClient.clear()
})

describe('data changed elsewhere', () => {
  it('reads bank sync again: the review inbox and its backlogs, the pending rows, the links and the connections', () => {
    const keys: QueryKey[] = [
      bankSyncKeys.reviewItems(undefined),
      bankSyncKeys.reviewItems(['account-1']),
      bankSyncKeys.reviewBacklogs(undefined),
      bankSyncKeys.pending(['account-1']),
      bankSyncKeys.links(),
      bankSyncKeys.connections(),
    ]
    for (const key of keys) queryClient.setQueryData(key, {})

    invalidateAppData(queryClient)

    for (const key of keys) {
      expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true)
    }
  })
})
