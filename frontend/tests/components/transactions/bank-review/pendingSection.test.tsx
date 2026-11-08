/**
 * Covers the pending strip's section under the review block: which accounts' pending transactions it
 * reads for a filtered list, when it hides, and how a failed read shows
 *
 * These tests catch the strip counting pending transactions of accounts the list doesn't show, or of
 * a group account the server refuses, showing an empty strip with nothing pending, failing the page
 * over a transaction whose account isn't loaded, and a failed read leaving no trace or vanishing
 * while it is read again. The account page leaving names out, opening the strip and the refresh
 * after a sync run in the browser, since the strip is closed until clicked and the refresh needs effects
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/auth/errors'
import { accountKeys, bankSyncKeys } from '@/api/cache/queryKeys'
import { formatCurrency, formatMovedCurrency } from '@/utils/formatCurrency'
import { createAccount, createLinks, createPendingTransaction, TEST_CURRENCIES } from './fixtures'

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies: TEST_CURRENCIES,
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, TEST_CURRENCIES),
    formatMovedCurrency: (amount: number, currency: string) => formatMovedCurrency(amount, currency, TEST_CURRENCIES),
  }),
}))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', tz: 'America/Toronto' }, accessToken: 'token' }),
}))
vi.mock('@/hooks/useTodayYmd', () => ({ useTodayYmd: () => '2026-10-05' }))

import { BankPendingSection } from '@/components/transactions/bank-review/PendingSection'

const ACCOUNTS = [
  createAccount('everyday', 'Everyday'),
  createAccount('savings', 'Savings'),
  createAccount('visa', 'Visa'),
  createAccount('joint', 'Joint', { owner_id: null, group_id: 'group-1' }),
]

const EVERYDAY_PENDING = [
  createPendingTransaction('everyday-1', 'everyday'),
  createPendingTransaction('everyday-2', 'everyday'),
]
const VISA_PENDING = createPendingTransaction('visa-1', 'visa')

let client: QueryClient

beforeEach(() => {
  // A failed read stays failed on render, as it does once the app's own retries have run out
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, retryOnMount: false } } })
  client.setQueryData(accountKeys.list(), ACCOUNTS)
  // Only a linked account has bank transactions, so each personal account is linked
  client.setQueryData(bankSyncKeys.links(), createLinks(['everyday', 'savings', 'visa']))
})

function renderSection(listAccountIds?: string[]): string {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(BankPendingSection, { listAccountIds, isFixedAccount: false, prefersReducedMotion: true }),
    ),
  )
}

describe('the strip for every account', () => {
  it("counts every account's pending transactions", () => {
    client.setQueryData(bankSyncKeys.pending(undefined), [VISA_PENDING, ...EVERYDAY_PENDING])

    expect(renderSection()).toContain('>3 pending<')
  })

  it("leaves out a pending transaction whose account isn't loaded, rather than failing the page", () => {
    client.setQueryData(bankSyncKeys.pending(undefined), [
      VISA_PENDING,
      createPendingTransaction('gone-1', 'deleted-elsewhere'),
    ])

    expect(renderSection()).toContain('>1 pending<')
  })

  it('is hidden while nothing is pending', () => {
    client.setQueryData(bankSyncKeys.pending(undefined), [])

    expect(renderSection()).toBe('')
  })

  it('says inside the strip that the pending transactions could not load, rather than disappearing', () => {
    client
      .getQueryCache()
      .build(client, { queryKey: bankSyncKeys.pending(undefined) })
      .setState({
        status: 'error',
        error: new ApiError('Request failed', 500),
        errorUpdateCount: 1,
      })

    expect(renderSection()).toMatch(
      /aria-label="Pending bank transactions".*Pending bank transactions could not load\.<\/span><button[^>]*>Try again</,
    )
  })

  // A retry of a read with nothing loaded clears its error while it runs
  it('keeps saying they could not load while they are read again', () => {
    client
      .getQueryCache()
      .build(client, { queryKey: bankSyncKeys.pending(undefined) })
      .setState({
        status: 'pending',
        fetchStatus: 'fetching',
        error: null,
        errorUpdateCount: 1,
      })

    expect(renderSection()).toMatch(
      /Pending bank transactions could not load\.<\/span><button[^>]*aria-busy="true"[^>]*>Retrying…</,
    )
  })
})

describe('the strip for a filtered list', () => {
  beforeEach(() => {
    client.setQueryData(bankSyncKeys.pending(undefined), [VISA_PENDING, ...EVERYDAY_PENDING])
    client.setQueryData(bankSyncKeys.pending(['visa']), [VISA_PENDING])
    client.setQueryData(bankSyncKeys.pending(['savings']), [])
  })

  it("counts only the filtered account's pending transactions", () => {
    expect(renderSection(['visa'])).toContain('>1 pending<')
  })

  it('reads a list filtered to a personal and a group account for the personal one alone', () => {
    expect(renderSection(['visa', 'joint'])).toContain('>1 pending<')
  })

  it('is hidden for an account with nothing pending, and for a list filtered to group accounts alone', () => {
    expect(renderSection(['savings'])).toBe('')
    expect(renderSection(['joint'])).toBe('')
  })
})
