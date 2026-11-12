/**
 * Covers the waiting bank items after a transaction is edited or deleted. An item shows its
 * transaction's ledger date and amount (the server reads them each time it lists the item), a move
 * out of its account drops the transaction's bank record and its item, and deleting the transaction
 * deletes the item too
 *
 * These tests catch the review block still showing a deleted transaction's removal, an edited
 * transaction's old amount or date, or the item of one moved out of its account, whether the edit or
 * deletion was to one transaction or to several, or the edit to one the cache never held, and a change
 * that leaves every item as it was, to a manual transaction or to a bank one's category, reading every
 * loaded page of the inbox again for nothing
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransactionBankSource } from '@/api/bank-sync/types'
import { bankSyncKeys, transactionKeys } from '@/api/cache/queryKeys'
import type { Transaction } from '@/api/transactions/types'

const { authenticatedFetchMock } = vi.hoisted(() => ({ authenticatedFetchMock: vi.fn() }))
vi.mock('@/api/client', () => ({ authenticatedFetch: authenticatedFetchMock }))

import {
  useBulkDeleteTransactions,
  useBulkUpdateTransactions,
  useDeleteTransaction,
  useUpdateTransaction,
} from '@/api/transactions/hooks'

// An Uber trip the bank no longer reports, its removal waiting in the review block
const SOURCE: TransactionBankSource = {
  provider: 'simplefin',
  provider_name: 'SimpleFIN',
  bank_values: { date: '2026-10-04', amount: -1800, raw_amount: null, description: 'UBER TRIP' },
  received_at: '2026-10-04T09:05:00Z',
  edited_fields: [],
  review_item_id: 'item-1',
}

/** Builds an $18.00 spend in Everyday on Oct 4, imported from the bank when given its source */
function createTransaction(id: string, bankSource: TransactionBankSource | null): Transaction {
  return {
    id,
    created_by_user_id: 'user-1',
    account_id: 'everyday',
    dt: '2026-10-04',
    merchant_id: null,
    merchant_name: 'Uber',
    category_id: 'transport',
    amount: -1800,
    account_amount: null,
    base_currency_amount: null,
    currency: 'CAD',
    fx_rate: null,
    notes: null,
    counterparty_account_id: null,
    counterparty_account_scope: null,
    created_at: '2026-10-04T12:00:00Z',
    updated_at: '2026-10-04T12:00:00Z',
    tag_ids: [],
    tags: [],
    refund_of_transaction_id: null,
    refund_transaction_ids: [],
    bank_source: bankSource,
  }
}

const BANK_IMPORTED = createTransaction('uber', SOURCE)
const MANUAL = createTransaction('coffee', null)
const reviewItemsKey = bankSyncKeys.reviewItems(undefined)

let client: QueryClient

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(transactionKeys.list({}), [BANK_IMPORTED, MANUAL])
  client.setQueryData(reviewItemsKey, { pages: [], pageParams: [] })
  authenticatedFetchMock.mockReset()
})

afterEach(() => {
  client.clear()
})

/** Renders the transaction mutations against the test's cache, to run outside any render */
function renderMutations() {
  let update!: ReturnType<typeof useUpdateTransaction>
  let bulkUpdate!: ReturnType<typeof useBulkUpdateTransactions>
  let remove!: ReturnType<typeof useDeleteTransaction>
  let bulkRemove!: ReturnType<typeof useBulkDeleteTransactions>
  function Harness() {
    update = useUpdateTransaction()
    bulkUpdate = useBulkUpdateTransactions()
    remove = useDeleteTransaction()
    bulkRemove = useBulkDeleteTransactions()
    return null
  }
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Harness)))
  return { update, bulkUpdate, remove, bulkRemove }
}

function isReviewStale(): boolean | undefined {
  return client.getQueryState(reviewItemsKey)?.isInvalidated
}

describe('the waiting bank items after a change to a bank-imported transaction', () => {
  it('are read again after an edit to the amount they show of it', async () => {
    authenticatedFetchMock.mockResolvedValue({ ...BANK_IMPORTED, amount: -1900 })

    await renderMutations().update.mutateAsync({ id: 'uber', patch: { amount: -1900 } })

    expect(isReviewStale()).toBe(true)
  })

  it('are read again after an edit to it while the cache held no copy, its source read from the answer', async () => {
    client.setQueryData(transactionKeys.list({}), [MANUAL])
    authenticatedFetchMock.mockResolvedValue({ ...BANK_IMPORTED, amount: -1900 })

    await renderMutations().update.mutateAsync({ id: 'uber', patch: { amount: -1900 } })

    expect(isReviewStale()).toBe(true)
  })

  it('are read again after a move out of its account, since the server answers without its bank source', async () => {
    authenticatedFetchMock.mockResolvedValue({ ...BANK_IMPORTED, account_id: 'savings', bank_source: null })

    await renderMutations().update.mutateAsync({ id: 'uber', patch: { account_id: 'savings' } })

    expect(isReviewStale()).toBe(true)
  })

  it('are read again after a bulk edit reaching it among others', async () => {
    authenticatedFetchMock.mockResolvedValue({ transactions_updated: 2, affected_account_ids: ['everyday'] })

    await renderMutations().bulkUpdate.mutateAsync({ transaction_ids: ['coffee', 'uber'], dt: '2026-10-01' })

    expect(isReviewStale()).toBe(true)
  })

  it('are read again once it is deleted', async () => {
    authenticatedFetchMock.mockResolvedValue(undefined)

    await renderMutations().remove.mutateAsync('uber')

    expect(isReviewStale()).toBe(true)
  })

  it('are read again after a bulk delete reaching it among others', async () => {
    authenticatedFetchMock.mockResolvedValue({ transactions_deleted: 2, affected_account_ids: ['everyday'] })

    await renderMutations().bulkRemove.mutateAsync({ transactionIds: ['coffee', 'uber'] })

    expect(isReviewStale()).toBe(true)
  })

  it('are left as they are after an edit to its category, alone or in bulk', async () => {
    const { update, bulkUpdate } = renderMutations()

    authenticatedFetchMock.mockResolvedValue({ ...BANK_IMPORTED, category_id: 'travel' })
    await update.mutateAsync({ id: 'uber', patch: { category_id: 'travel' } })
    authenticatedFetchMock.mockResolvedValue({ transactions_updated: 1, affected_account_ids: ['everyday'] })
    await bulkUpdate.mutateAsync({ transaction_ids: ['uber'], category_id: 'travel' })

    expect(isReviewStale()).toBe(false)
  })
})

describe('the waiting bank items after a change to a manual transaction', () => {
  it('are left as they are after an edit, a bulk edit, a deletion or a bulk deletion', async () => {
    const { update, bulkUpdate, remove, bulkRemove } = renderMutations()

    authenticatedFetchMock.mockResolvedValue({ ...MANUAL, amount: -1900 })
    await update.mutateAsync({ id: 'coffee', patch: { amount: -1900 } })
    authenticatedFetchMock.mockResolvedValue({ transactions_updated: 1, affected_account_ids: ['everyday'] })
    await bulkUpdate.mutateAsync({ transaction_ids: ['coffee'], dt: '2026-10-01' })
    authenticatedFetchMock.mockResolvedValue(undefined)
    await remove.mutateAsync('coffee')

    // The deletion dropped the coffee from the cache, so it goes back for the bulk delete to read
    client.setQueryData(transactionKeys.list({}), [BANK_IMPORTED, MANUAL])
    authenticatedFetchMock.mockResolvedValue({ transactions_deleted: 1, affected_account_ids: ['everyday'] })
    await bulkRemove.mutateAsync({ transactionIds: ['coffee'] })

    expect(isReviewStale()).toBe(false)
  })
})
