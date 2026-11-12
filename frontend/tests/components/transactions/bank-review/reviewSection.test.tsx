/**
 * Covers the review section above the transaction list: what each kind of waiting item shows, the
 * accounts whose items it reads for a filtered list and an account's own page, the currency each amount
 * is written in, its empty and failure states, and the backlog notice
 *
 * These tests catch the section reading items the list doesn't show, or a group account's that the
 * server refuses, an account's page naming its own account on every row, an amount written in
 * another account's currency, a failed read leaving no trace or vanishing while it is read again,
 * the header counting only the loaded page of a large backlog, a marker's request opening a block of
 * four or fewer, a block that closes itself again on every render, and the notice missing or worded unlike
 * the status labels. Following a
 * Needs review marker to an item and loading more as the open block scrolls run in the browser,
 * since they need effects and a layout
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/auth/errors'
import type { BankReviewBacklog } from '@/api/bank-sync/types'
import { accountKeys, bankSyncKeys } from '@/api/cache/queryKeys'
import { formatCurrency, formatMovedCurrency } from '@/utils/formatCurrency'
import {
  createAccount,
  createLinks,
  createReviewItem,
  MINUS,
  rowCount,
  TEST_CURRENCIES,
  textOf,
  toPages,
} from './fixtures'

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

import { BankReviewSection, type ReviewFocusRequest } from '@/components/transactions/bank-review/ReviewSection'

const ACCOUNTS = [
  createAccount('everyday', 'Everyday'),
  createAccount('savings', 'Savings'),
  createAccount('visa', 'Visa'),
  createAccount('joint', 'Joint', { owner_id: null, group_id: 'group-1' }),
]

const VISA_CORRECTION = createReviewItem('visa-1', 'correction', 'visa', {
  bank: { date: '2026-09-21', amount: -2310, raw_amount: null, description: 'COUNTDOWN 123' },
})
const EVERYDAY_ITEMS = [
  createReviewItem('everyday-1', 'new', 'everyday'),
  createReviewItem('everyday-2', 'new', 'everyday'),
]

let client: QueryClient

beforeEach(() => {
  // A failed read stays failed on render, as it does once the app's own retries have run out
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, retryOnMount: false } } })
  client.setQueryData(accountKeys.list(), ACCOUNTS)
  // Only a linked account has bank items, so each personal account is linked
  client.setQueryData(bankSyncKeys.links(), createLinks(['everyday', 'savings', 'visa']))
})

function renderSection(
  listAccountIds?: string[],
  isFixedAccount = false,
  focusRequest: ReviewFocusRequest | null = null,
): string {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(BankReviewSection, { listAccountIds, isFixedAccount, focusRequest, prefersReducedMotion: true }),
    ),
  )
}

/** The markup of the one row holding this text */
function rowWith(markup: string, text: string): string {
  const rows = markup
    .split('role="listitem"')
    .slice(1)
    .filter((row) => row.includes(text))
  expect(rows).toHaveLength(1)
  return rows[0]
}

describe('the block for every account', () => {
  it('shows each kind of item with its date, account and what it asks, counted in the header', () => {
    client.setQueryData(bankSyncKeys.reviewItems(undefined), toPages([VISA_CORRECTION, ...EVERYDAY_ITEMS]))

    const markup = renderSection()

    expect(markup).toContain('Waiting for review')
    expect(markup).toMatch(/>3<\/span>/)
    expect(markup).toContain('Bank items stay out of every balance until you add them to your ledger.')
    expect(markup).toMatch(/COUNTDOWN 123<span[^>]*> <\/span><span[^>]*>Correction<\/span>/)
    expect(textOf(markup)).toContain('Sep 21 · Visa · The bank changed the amount')
    expect(textOf(markup)).toContain('Sep 21 · Everyday · Needs merchant and category')
    expect(markup).toContain(`${MINUS}$23.10`)
  })

  it("writes each item's amount in its own account's currency", () => {
    client.setQueryData(accountKeys.list(), [...ACCOUNTS, createAccount('tokyo', 'Tokyo', { currency: 'JPY' })])
    client.setQueryData(
      bankSyncKeys.reviewItems(undefined),
      toPages([createReviewItem('everyday-1', 'new', 'everyday'), createReviewItem('tokyo-1', 'new', 'tokyo')]),
    )

    const markup = renderSection()

    expect(rowWith(markup, 'GROCER everyday-1')).toContain(`>${MINUS}$12.50<`)
    expect(rowWith(markup, 'GROCER tokyo-1')).toContain(`>${MINUS}¥1,250<`)
  })

  it('counts every waiting item while only the first page of a 1,500 item backlog has loaded', () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => createReviewItem(`item-${index}`, 'new', 'everyday'))
    client.setQueryData(
      bankSyncKeys.reviewItems(undefined),
      toPages(firstPage, { new: 1500, correction: 0, removal: 0 }, 'cursor-2'),
    )

    const markup = renderSection()

    expect(markup).toMatch(/>1,500<\/span>/)
    expect(markup).toContain('Show all 1,500')
    expect(rowCount(markup)).toBe(4)
  })

  it('is hidden while nothing waits', () => {
    client.setQueryData(bankSyncKeys.reviewItems(undefined), toPages([]))

    expect(renderSection()).toBe('')
  })

  it('says inside the block that the items could not load, rather than disappearing', () => {
    client
      .getQueryCache()
      .build(client, { queryKey: bankSyncKeys.reviewItems(undefined) })
      .setState({
        status: 'error',
        error: new ApiError('Request failed', 500),
        errorUpdateCount: 1,
      })

    expect(renderSection()).toMatch(
      /Waiting for review<\/h2>.*Bank items to review could not load\.<\/span><button[^>]*>Try again</,
    )
  })

  // A retry of a read with nothing loaded clears its error while it runs
  it('keeps saying the items could not load while they are read again', () => {
    client
      .getQueryCache()
      .build(client, { queryKey: bankSyncKeys.reviewItems(undefined) })
      .setState({
        status: 'pending',
        fetchStatus: 'fetching',
        error: null,
        errorUpdateCount: 1,
      })

    expect(renderSection()).toMatch(
      /Bank items to review could not load\.<\/span><button[^>]*aria-busy="true"[^>]*>Retrying…</,
    )
  })
})

describe('the block for a filtered list or an account page', () => {
  beforeEach(() => {
    client.setQueryData(bankSyncKeys.reviewItems(undefined), toPages([VISA_CORRECTION, ...EVERYDAY_ITEMS]))
    client.setQueryData(bankSyncKeys.reviewItems(['visa']), toPages([VISA_CORRECTION]))
    client.setQueryData(bankSyncKeys.reviewItems(['savings']), toPages([]))
  })

  it("shows only the filtered account's items", () => {
    const markup = renderSection(['visa'])

    expect(markup).toMatch(/>1<\/span>/)
    expect(rowCount(markup)).toBe(1)
    expect(markup).not.toContain('Everyday')
  })

  it('reads a list filtered to a personal and a group account for the personal one alone', () => {
    expect(rowCount(renderSection(['visa', 'joint']))).toBe(1)
  })

  it('is hidden for an account with nothing waiting, and for a list filtered to group accounts alone', () => {
    expect(renderSection(['savings'])).toBe('')
    expect(renderSection(['joint'])).toBe('')
  })

  it("leaves the account's name off each row on its own page", () => {
    expect(textOf(renderSection(['visa'], true))).toContain('Sep 21 · The bank changed the amount')
  })
})

describe('a Needs review marker', () => {
  it("leaves a block of four or fewer closed while it looks for an item the block hasn't shown", () => {
    client.setQueryData(bankSyncKeys.reviewItems(undefined), toPages([VISA_CORRECTION, ...EVERYDAY_ITEMS]))

    // Read again, as after a sync, so the item could still arrive and the marker's request stays open
    client
      .getQueryCache()
      .find({ queryKey: bankSyncKeys.reviewItems(undefined) })
      ?.setState({ fetchStatus: 'fetching' })

    const markup = renderSection(undefined, false, { itemId: 'item-elsewhere', nonce: 1 })

    expect(rowCount(markup)).toBe(3)
    expect(markup).not.toContain('aria-expanded')
  })
})

describe('the backlog notice', () => {
  const backlogs: BankReviewBacklog[] = [
    { account_id: 'everyday', waiting_new_count: 105, paused: true, review_warning: false },
    { account_id: 'savings', waiting_new_count: 85, paused: false, review_warning: true },
  ]

  beforeEach(() => {
    client.setQueryData(bankSyncKeys.reviewItems(undefined), toPages(EVERYDAY_ITEMS))
    client.setQueryData(
      bankSyncKeys.reviewItems(['savings']),
      toPages([createReviewItem('savings-1', 'new', 'savings')]),
    )
  })

  it('says a paused account has stopped syncing, over a warned one', () => {
    client.setQueryData(bankSyncKeys.reviewBacklogs(undefined), backlogs)

    expect(renderSection()).toContain('Paused · 105 new to review in Everyday. Sync resumes at 50 or fewer.')
  })

  it('warns that an account filtered to is close to pausing', () => {
    client.setQueryData(bankSyncKeys.reviewBacklogs(['savings']), [backlogs[1]])

    expect(renderSection(['savings'])).toContain('85 new to review in Savings. Sync pauses at 100.')
  })

  it('says the pause status could not load while the items did', () => {
    client
      .getQueryCache()
      .build(client, { queryKey: bankSyncKeys.reviewBacklogs(undefined) })
      .setState({
        status: 'error',
        error: new ApiError('Request failed', 500),
        errorUpdateCount: 1,
      })

    expect(renderSection()).toContain('Sync pause status could not load')
  })

  it('keeps saying the pause status could not load while it is read again', () => {
    client
      .getQueryCache()
      .build(client, { queryKey: bankSyncKeys.reviewBacklogs(undefined) })
      .setState({
        status: 'pending',
        fetchStatus: 'fetching',
        error: null,
        errorUpdateCount: 1,
      })

    expect(renderSection()).toMatch(
      /Sync pause status could not load\.<\/span><button[^>]*aria-busy="true"[^>]*>Retrying…</,
    )
  })
})
