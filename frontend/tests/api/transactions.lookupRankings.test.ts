import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { merchantKeys } from '@/api/cache/queryKeys'
import type { Transaction } from '@/api/transactions'

const requests = vi.hoisted(() => ({ create: vi.fn(), remove: vi.fn() }))
vi.mock('@/api/transactions/requests', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/transactions/requests')>(),
  createTransaction: requests.create,
  deleteTransaction: requests.remove,
}))

import { applyTransactionDeletion, useCreateTransaction, useDeleteTransaction, useRefreshCreatedTransactions } from '@/api/transactions/hooks'

const clients: QueryClient[] = []
const lookup = merchantKeys.infinite({}, 20)
afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  vi.clearAllMocks()
})

function harness(deferred: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  clients.push(client)
  client.setQueryData(lookup, { pages: [[]], pageParams: [0] })
  let create!: ReturnType<typeof useCreateTransaction>
  let remove!: ReturnType<typeof useDeleteTransaction>
  let flush!: ReturnType<typeof useRefreshCreatedTransactions>
  function Harness() {
    create = useCreateTransaction({ deferTransactionInvalidation: deferred, deferAccountInvalidation: deferred })
    remove = useDeleteTransaction({ deferRemoval: deferred })
    flush = useRefreshCreatedTransactions()
    return null
  }
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Harness)))
  return { client, create, remove, flush }
}

const payload = {
  account_id: 'checking', dt: '2026-09-18', category_id: 'groceries', merchant_id: 'merchant',
  amount: -4250, currency: 'CAD',
}

const transaction: Transaction = {
  ...payload,
  id: 'transaction', created_by_user_id: 'user', merchant_name: 'Merchant',
  account_amount: null, base_currency_amount: null, fx_rate: null, notes: null,
  counterparty_account_id: null, counterparty_account_scope: null,
  created_at: '2026-09-18T12:00:00Z', updated_at: '2026-09-18T12:00:00Z',
  tag_ids: [], tags: [],
}

describe('actual transaction mutation lookup refresh boundaries', () => {
  it('refreshes ordinary create and deletion lookups', async () => {
    requests.create.mockResolvedValue(transaction)
    requests.remove.mockResolvedValue(undefined)
    const created = harness(false)
    await created.create.mutateAsync(payload)
    expect(created.client.getQueryState(lookup)?.isInvalidated).toBe(true)
    const removed = harness(false)
    await removed.remove.mutateAsync('transaction')
    expect(removed.client.getQueryState(lookup)?.isInvalidated).toBe(true)
  })

  it('holds ranked lookup invalidation across two deferred creates and flushes it once', async () => {
    requests.create.mockResolvedValue(transaction)
    const { client, create, flush } = harness(true)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await create.mutateAsync(payload)
    await create.mutateAsync(payload)
    expect(client.getQueryState(lookup)?.isInvalidated).toBe(false)
    const lookupCalls = () => invalidate.mock.calls.filter(([filters]) =>
      filters?.queryKey?.[0] === 'merchants' && Boolean(filters.predicate))
    expect(lookupCalls()).toHaveLength(0)
    flush(['checking'])
    expect(client.getQueryState(lookup)?.isInvalidated).toBe(true)
    expect(lookupCalls()).toHaveLength(1)
  })

  it('holds deferred deletion lookup refresh until its cache application', async () => {
    requests.remove.mockResolvedValue(undefined)
    const { client, remove } = harness(true)
    await remove.mutateAsync('transaction')
    expect(client.getQueryState(lookup)?.isInvalidated).toBe(false)
    applyTransactionDeletion(client, 'transaction', 'checking')
    expect(client.getQueryState(lookup)?.isInvalidated).toBe(true)
  })
})
