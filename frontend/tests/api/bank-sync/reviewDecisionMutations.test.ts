/**
 * Covers a review decision the server refuses, through the query cache the app runs on
 *
 * These tests catch an item decided in another tab or on another device, or withdrawn by the bank,
 * staying in the review block after a decision on it fails here, whether that was Add to ledger or
 * any other decision, and the waiting counts beside the block staying as they were
 */
import { MutationObserver, QueryClient, type QueryKey } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}))

import { ApiError } from '@/api/auth'
import { addReviewItemMutationOptions, resolveReviewItemMutationOptions } from '@/api/bank-sync/hooks'
import { accountKeys, bankSyncKeys, transactionKeys } from '@/api/cache/queryKeys'

let queryClient: QueryClient

const reviewKeys: QueryKey[] = [
  bankSyncKeys.reviewItems(undefined),
  bankSyncKeys.reviewBacklogs(undefined),
  bankSyncKeys.bulkPreview(undefined),
  bankSyncKeys.links(),
]
const untouchedKeys: QueryKey[] = [transactionKeys.list({}), accountKeys.detail('account-1')]

function expectInvalidated(keys: QueryKey[], invalidated: boolean): void {
  for (const key of keys) {
    expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(invalidated)
  }
}

const refusals = [
  [
    'Add to ledger on an item dismissed elsewhere',
    () =>
      new MutationObserver(queryClient, addReviewItemMutationOptions(queryClient)).mutate({
        itemId: 'item-1',
        payload: { category_id: 'groceries', merchant_id: 'merchant-1', dt: '2026-10-04', amount: -1250 },
      }),
    new ApiError("This item was dismissed, so it can't be added to the ledger", 409),
  ],
  [
    'a dismissal of an item added to the ledger elsewhere',
    () =>
      new MutationObserver(queryClient, resolveReviewItemMutationOptions(queryClient)).mutate({
        itemId: 'item-1',
        resolution: 'dismiss',
        accountId: 'account-1',
      }),
    new ApiError("This item is already in the ledger, so it can't be dismissed", 409),
  ],
] as const

beforeEach(() => {
  authenticatedFetchMock.mockReset()
  vi.useFakeTimers()
  queryClient = new QueryClient()
  for (const key of [...reviewKeys, ...untouchedKeys]) queryClient.setQueryData(key, {})
})

afterEach(() => {
  queryClient.clear()
  vi.useRealTimers()
})

describe('a review decision the server refuses', () => {
  it.each(refusals)('reads the inbox and its waiting counts again after %s', async (_, decide, refusal) => {
    authenticatedFetchMock.mockRejectedValue(refusal)

    const sent = decide().catch((error: unknown) => error)
    await vi.runAllTimersAsync()

    expect(await sent).toBe(refusal)
    expectInvalidated(reviewKeys, true)
    expectInvalidated(untouchedKeys, false)
  })
})
