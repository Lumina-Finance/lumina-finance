import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { invalidateAppData, invalidateMerchantLookupPages } from '@/api/cache/invalidation'
import { invalidateBulkUpdatedTransactionData, invalidateFinancialTransactionData, invalidatePatchedTransactionData } from '@/api/cache/updates/transactions'
import { merchantKeys } from '@/api/cache/queryKeys'
import type { BulkUpdateTransactionsPayload, UpdateTransactionPayload } from '@/api/transactions'

const clients: QueryClient[] = []
const lookup = merchantKeys.infinite({}, 20)
const filtered = merchantKeys.infinite({ q: 'bank', group_id: 'group' }, 10)
const detail = merchantKeys.detail('merchant')
const matches = [...merchantKeys.nameMatchesAll, ['Alpha']] as const

afterEach(() => { for (const client of clients.splice(0)) client.clear() })

function seed() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  clients.push(client)
  client.setQueryData(lookup, { pages: [['Alpha', 'Zulu']], pageParams: [0] })
  client.setQueryData(filtered, { pages: [['Bank A'], ['Bank B']], pageParams: [0, 10] })
  client.setQueryData(detail, { name: 'Alpha' })
  client.setQueryData(matches, { matches: [] })
  return client
}

function expectLookupOnly(client: QueryClient) {
  expect(client.getQueryState(lookup)?.isInvalidated).toBe(true)
  expect(client.getQueryState(filtered)?.isInvalidated).toBe(true)
  expect(client.getQueryState(detail)?.isInvalidated).toBe(false)
  expect(client.getQueryState(matches)?.isInvalidated).toBe(false)
}

describe('transaction usage-ranked merchant lookup invalidation', () => {
  it.each([{ merchant_id: 'other' }, { dt: '2026-01-01' }, { category_id: 'adjustment' }])(
    'refreshes lookup pages after relevant single and bulk edit %j', (patch) => {
      const single = seed()
      invalidatePatchedTransactionData(single, patch, ['account'])
      expectLookupOnly(single)
      const bulk = seed()
      invalidateBulkUpdatedTransactionData(bulk, { transaction_ids: ['transaction'], ...patch }, ['account'])
      expectLookupOnly(bulk)
    },
  )

  it('refreshes lookup pages when a single edit removes its merchant', () => {
    const client = seed()
    invalidatePatchedTransactionData(client, { merchant_id: null }, ['account'])
    expectLookupOnly(client)
  })

  it.each([{ amount: -5000 }, { account_id: 'other' }, { notes: 'Changed' }, { tag_ids: ['tag'] }] satisfies UpdateTransactionPayload[])(
    'preserves rankings after unrelated edit %j', (patch) => {
      const client = seed()
      invalidatePatchedTransactionData(client, patch, ['account'])
      expect(client.getQueryState(lookup)?.isInvalidated).toBe(false)
      expect(client.getQueryState(filtered)?.isInvalidated).toBe(false)
    },
  )

  it.each([
    { account_id: 'other' }, { notes: 'Changed' }, { add_tag_ids: ['tag'] },
    { direction: 'reverse' },
  ] satisfies Omit<BulkUpdateTransactionsPayload, 'transaction_ids'>[])(
    'preserves rankings after unrelated bulk edit %j', (patch) => {
      const client = seed()
      invalidateBulkUpdatedTransactionData(client, { transaction_ids: ['transaction'], ...patch }, ['account'])
      expect(client.getQueryState(lookup)?.isInvalidated).toBe(false)
      expect(client.getQueryState(filtered)?.isInvalidated).toBe(false)
    },
  )

  it('refreshes create/delete data but preserves explicit deferred create lookup pages', () => {
    const ordinary = seed()
    invalidateFinancialTransactionData(ordinary, ['account'])
    expectLookupOnly(ordinary)
    const deferred = seed()
    invalidateFinancialTransactionData(deferred, ['account'], { deferMerchantLookupInvalidation: true })
    expect(deferred.getQueryState(lookup)?.isInvalidated).toBe(false)
  })

  it('refetches an active infinite lookup once and marks inactive pages stale without refetching them', async () => {
    const client = seed()
    const activeFetch = vi.fn().mockResolvedValue(['Zulu', 'Alpha'])
    const inactiveFetch = vi.fn().mockResolvedValue(['Bank A'])
    client.setQueryDefaults(filtered, { queryFn: inactiveFetch })
    const observer = new InfiniteQueryObserver(client, {
      queryKey: lookup, queryFn: activeFetch, initialPageParam: 0, getNextPageParam: () => undefined,
    })
    const unsubscribe = observer.subscribe(() => {})
    try {
      expect(activeFetch).not.toHaveBeenCalled()
      invalidateMerchantLookupPages(client)
      await vi.waitFor(() => expect(observer.getCurrentResult().data?.pages).toEqual([['Zulu', 'Alpha']]))
      expect(activeFetch).toHaveBeenCalledOnce()
      expect(inactiveFetch).not.toHaveBeenCalled()
      expect(client.getQueryState(filtered)?.isInvalidated).toBe(true)
      expect(client.getQueryData(filtered)).toEqual({ pages: [['Bank A'], ['Bank B']], pageParams: [0, 10] })
    } finally { unsubscribe() }
  })

  it('retains the existing import-wide merchant invalidation', () => {
    const client = seed()
    invalidateAppData(client)
    expect(client.getQueryState(lookup)?.isInvalidated).toBe(true)
    expect(client.getQueryState(filtered)?.isInvalidated).toBe(true)
  })
})
