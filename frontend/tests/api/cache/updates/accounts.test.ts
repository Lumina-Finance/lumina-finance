/**
 * Tests the cache writes a starting balance relies on, so the new account shows the balance at once
 * and the net worth and credit figures built on it don't keep the zero it was created with, including
 * after a save that ended with no answer and may have landed
 *
 * useRecordStartingBalance calls useMutation and useQueryClient, which need a live React tree, so
 * this covers the cache updates directly against a real QueryClient
 */
import { QueryClient, type QueryKey } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { Account, AccountsOverview } from '@/api/accounts'
import {
  accountKeys,
  bankSyncKeys,
  dashboardKeys,
  insightsKeys,
  transactionKeys,
  transactionOverviewKeys,
  userKeys,
} from '@/api/cache/queryKeys'
import { applyRecordedStartingBalance, refreshAfterInterruptedStartingBalance } from '@/api/cache/updates/accounts'

// Every view a starting balance changes, by name, so a failure says which one was left fresh
const STARTING_BALANCE_VIEWS: Record<string, QueryKey> = {
  accountBalanceHistory: accountKeys.snapshots('card', {}),
  bankLink: bankSyncKeys.accountStatus('card'),
  transactions: transactionKeys.list({}),
  transactionOverview: transactionOverviewKeys.detail({}),
  dashboardNetWorth: dashboardKeys.netWorth(30),
  dashboardRecent: dashboardKeys.recentActivity(30),
  insightsGlance: insightsKeys.periodGlance('2026-10-01', '2026-10-31'),
  insightsNetWorth: insightsKeys.netWorth('2026-10-01', '2026-10-31'),
  runway: userKeys.runway(),
  credit: dashboardKeys.credit(),
}

/**
 * Creates a CAD credit card as account creation returns it, in minor units
 */
function createCard(currentBalance: number): Account {
  return {
    id: 'card',
    owner_id: 'user',
    group_id: null,
    account_kind: 'revolving',
    account_type: 'credit_card',
    tax_advantaged_category_id: null,
    name: 'Rewards Card',
    institution: null,
    currency: 'CAD',
    current_balance: currentBalance,
    base_currency_current_balance: null,
    current_balance_fx_status: { state: 'none', missing_pairs: [] },
    credit_limit: 200000,
    can_write: true,
    is_archived: false,
    created_at: '2026-10-04T12:00:00Z',
    has_transactions_after_today: false,
    notes: null,
  }
}

/**
 * Creates a client holding the card at zero and every view a starting balance changes
 */
function createSeededClient(): QueryClient {
  const queryClient = new QueryClient()
  queryClient.setQueryData(accountKeys.list(), [createCard(0)])
  queryClient.setQueryData(accountKeys.detail('card'), createCard(0))
  for (const queryKey of Object.values(STARTING_BALANCE_VIEWS)) queryClient.setQueryData(queryKey, {})
  return queryClient
}

/**
 * Names the views a starting balance changes that are not yet marked stale
 */
function freshViews(queryClient: QueryClient): string[] {
  return Object.entries(STARTING_BALANCE_VIEWS)
    .filter(([, queryKey]) => !queryClient.getQueryState(queryKey)?.isInvalidated)
    .map(([name]) => name)
}

describe('applyRecordedStartingBalance', () => {
  it('shows a card owing 400.00 at once and marks every view built on its balance stale', () => {
    const queryClient = createSeededClient()

    applyRecordedStartingBalance(queryClient, createCard(-40000))

    const accounts = queryClient.getQueryData<AccountsOverview[]>(accountKeys.list())
    expect(accounts?.map((account) => account.current_balance)).toEqual([-40000])
    expect(queryClient.getQueryData<Account>(accountKeys.detail('card'))?.current_balance).toBe(-40000)
    expect(freshViews(queryClient)).toEqual([])
  })
})

describe('refreshAfterInterruptedStartingBalance', () => {
  it('reads the card and every view built on its balance again', () => {
    const queryClient = createSeededClient()

    refreshAfterInterruptedStartingBalance(queryClient, 'card')

    expect(queryClient.getQueryState(accountKeys.list())?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(accountKeys.detail('card'))?.isInvalidated).toBe(true)
    expect(freshViews(queryClient)).toEqual([])
  })
})
