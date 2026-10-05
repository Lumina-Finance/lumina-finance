/**
 * Covers the review block above the transaction list: what each kind of waiting item shows, which
 * accounts' items it reads for a filtered list and an account's own page, its empty and failure
 * states, the first four items and the toggle for the rest, and the backlog notice
 *
 * These tests catch the block reading items the list doesn't show, or a group account's that the
 * server refuses, an account's page naming its own account on every row, a failed read leaving no
 * trace, the header counting only the loaded page of a large backlog, a removal showing anything but
 * the ledger amount struck through, and the notice missing or worded unlike the status labels.
 * Following a Needs review marker to an item and loading more as the open block scrolls run in the
 * browser, since they need effects and a layout
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountsOverview } from '@/api/accounts/types'
import { ApiError } from '@/api/auth/errors'
import type { BankReviewBacklog, BankReviewItem, BankReviewItemKind, BankReviewPage } from '@/api/bank-sync/types'
import { accountKeys, bankSyncKeys } from '@/api/cache/queryKeys'
import type { Currency } from '@/api/currency'
import { formatCurrency, formatMovedAmount } from '@/utils/formatCurrency'

const CURRENCIES: Currency[] = [{ id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 }]

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies: CURRENCIES,
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, CURRENCIES),
    formatMovedAmount: (amount: number, currency: string) => formatMovedAmount(amount, currency, CURRENCIES),
  }),
}))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', tz: 'America/Toronto' }, accessToken: 'token' }),
}))
vi.mock('@/hooks/useTodayYmd', () => ({ useTodayYmd: () => '2026-10-05' }))

import { BankReviewBlock } from '@/components/transactions/bank-review/ReviewBlock'
import { BankReviewSection } from '@/components/transactions/bank-review/ReviewSection'

const MINUS = String.fromCodePoint(0x2212)

function createAccount(id: string, name: string, ownership: Partial<AccountsOverview> = {}): AccountsOverview {
  return {
    id,
    owner_id: 'user-1',
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name,
    institution: null,
    currency: 'USD',
    current_balance: 0,
    base_currency_current_balance: 0,
    current_balance_fx_status: 'ok',
    credit_limit: null,
    can_write: true,
    is_archived: false,
    ...ownership,
  } as AccountsOverview
}

const ACCOUNTS = [
  createAccount('everyday', 'Everyday'),
  createAccount('savings', 'Savings'),
  createAccount('visa', 'Visa'),
  createAccount('joint', 'Joint', { owner_id: null, group_id: 'group-1' }),
]

/** Builds an item of the given kind on an account, for $12.50 out on Sep 21 unless told otherwise */
function createItem(id: string, kind: BankReviewItemKind, accountId: string, overrides: Partial<BankReviewItem> = {}): BankReviewItem {
  const bank = { date: '2026-09-21', amount: -1250, raw_amount: null, description: `GROCER ${id}`, merchant_name: null, category_hint: null }
  return {
    id,
    kind,
    account_id: accountId,
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    external_transaction_id: `TRN-${id}`,
    received_at: '2026-09-22T12:00:00Z',
    version: 1,
    bank,
    transaction_id: kind === 'new' ? null : `transaction-${id}`,
    current: kind === 'new' ? null : { ...bank, amount: -1800 },
    changed_fields: kind === 'correction' ? ['amount'] : [],
    protected_fields: [],
    ...overrides,
  }
}

const VISA_CORRECTION = createItem('visa-1', 'correction', 'visa', {
  bank: { date: '2026-09-21', amount: -2310, raw_amount: null, description: 'COUNTDOWN 123', merchant_name: null, category_hint: null },
})
const EVERYDAY_ITEMS = [createItem('everyday-1', 'new', 'everyday'), createItem('everyday-2', 'new', 'everyday')]

function toPages(items: BankReviewItem[], counts = countOf(items), nextCursor: string | null = null): InfiniteData<BankReviewPage, string | null> {
  return { pages: [{ items, counts, next_cursor: nextCursor }], pageParams: [null] }
}

function countOf(items: BankReviewItem[]): BankReviewPage['counts'] {
  return {
    new: items.filter((item) => item.kind === 'new').length,
    correction: items.filter((item) => item.kind === 'correction').length,
    removal: items.filter((item) => item.kind === 'removal').length,
  }
}

let client: QueryClient

beforeEach(() => {
  // A failed read stays failed on render, as it does once the app's own retries have run out
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, retryOnMount: false } } })
  client.setQueryData(accountKeys.list(), ACCOUNTS)
})

function renderSection(listAccountIds?: string[], isFixedAccount = false): string {
  return renderToStaticMarkup(createElement(
    QueryClientProvider,
    { client },
    createElement(BankReviewSection, { listAccountIds, isFixedAccount, focusRequest: null, prefersReducedMotion: true }),
  ))
}

function rowCount(markup: string): number {
  return markup.split('role="listitem"').length - 1
}

describe('the block for every account', () => {
  it('shows each kind of item with its date, account and what it asks, counted in the header', () => {
    client.setQueryData(bankSyncKeys.reviewItems(undefined), toPages([VISA_CORRECTION, ...EVERYDAY_ITEMS]))

    const markup = renderSection()

    expect(markup).toContain('Waiting for review')
    expect(markup).toMatch(/>3<\/span>/)
    expect(markup).toContain('From your bank, and left out of every balance until you act on them.')
    expect(markup).toMatch(/COUNTDOWN 123<span[^>]*>Correction<\/span>/)
    expect(markup).toContain('Sep 21 · Visa · The bank changed the amount')
    expect(markup).toContain('Sep 21 · Everyday · Needs merchant and category')
    expect(markup).toContain(`${MINUS}$23.10`)
  })

  it('counts every waiting item while only the first page of a 1,500 item backlog has loaded', () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => createItem(`item-${index}`, 'new', 'everyday'))
    client.setQueryData(bankSyncKeys.reviewItems(undefined), toPages(firstPage, { new: 1500, correction: 0, removal: 0 }, 'cursor-2'))

    const markup = renderSection()

    expect(markup).toMatch(/>1,500<\/span>/)
    expect(markup).toContain('Show all 1,500')
    expect(rowCount(markup)).toBe(4)
  })

  it('is hidden while nothing waits', () => {
    client.setQueryData(bankSyncKeys.reviewItems(undefined), toPages([]))

    expect(renderSection()).toBe('')
  })

  it('says the items could not load rather than disappearing', () => {
    client.getQueryCache().build(client, { queryKey: bankSyncKeys.reviewItems(undefined) }).setState({
      status: 'error',
      error: new ApiError('Request failed', 500),
    })

    expect(renderSection()).toContain('Bank items to review could not load')
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

  it('is hidden for an account with nothing waiting, and for a group account it reads nothing for', () => {
    expect(renderSection(['savings'])).toBe('')
    expect(renderSection(['joint'])).toBe('')
  })

  it("leaves the account's name off each row on its own page", () => {
    expect(renderSection(['visa'], true)).toContain('Sep 21 · The bank changed the amount')
  })
})

describe('the backlog notice', () => {
  const backlogs: BankReviewBacklog[] = [
    { account_id: 'everyday', waiting_new_count: 105, paused: true, review_warning: false },
    { account_id: 'savings', waiting_new_count: 85, paused: false, review_warning: true },
  ]

  beforeEach(() => {
    client.setQueryData(bankSyncKeys.reviewItems(undefined), toPages(EVERYDAY_ITEMS))
    client.setQueryData(bankSyncKeys.reviewItems(['savings']), toPages([createItem('savings-1', 'new', 'savings')]))
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
    client.getQueryCache().build(client, { queryKey: bankSyncKeys.reviewBacklogs(undefined) }).setState({
      status: 'error',
      error: new ApiError('Request failed', 500),
    })

    expect(renderSection()).toContain('Sync pause status could not load')
  })
})

describe('the rows the block shows', () => {
  const items = Array.from({ length: 6 }, (_, index) => createItem(`item-${index}`, 'new', 'everyday'))

  function renderBlock(blockItems: BankReviewItem[], expanded: boolean): string {
    return renderToStaticMarkup(createElement(BankReviewBlock, {
      items: blockItems,
      total: blockItems.length,
      accountFor: () => ({ name: 'Everyday', currency: 'USD' }),
      showAccountNames: true,
      today: '2026-10-05',
      backlogNotice: null,
      backlogError: null,
      expanded,
      onToggleExpanded: () => {},
      hasMoreItems: false,
      isLoadingMore: false,
      loadMoreSentinelRef: () => {},
      skipEnterAnimation: false,
      highlightedId: null,
      registerRow: () => {},
      prefersReducedMotion: true,
    }))
  }

  it('shows the first four items until opened, then every one', () => {
    const collapsed = renderBlock(items, false)
    const expanded = renderBlock(items, true)

    expect(rowCount(collapsed)).toBe(4)
    expect(collapsed).toMatch(/aria-expanded="false"[^>]*>Show all 6</)
    expect(rowCount(expanded)).toBe(6)
    expect(expanded).toMatch(/aria-expanded="true"[^>]*>Show fewer</)
  })

  it('offers no toggle for four items or fewer', () => {
    expect(renderBlock(items.slice(0, 4), false)).not.toContain('Show all')
  })

  it("strikes through the ledger amount a removal would take out, and colours money in", () => {
    const markup = renderBlock([
      createItem('uber', 'removal', 'everyday'),
      createItem('refund', 'new', 'everyday', { bank: { ...createItem('refund', 'new', 'everyday').bank, amount: 4250 } }),
    ], false)

    expect(markup).toMatch(new RegExp(`text-decoration:line-through[^>]*>${MINUS}\\$18\\.00<`))
    expect(markup).toMatch(/color:var\(--app-positive\)[^>]*>\+\$42\.50</)
  })
})
