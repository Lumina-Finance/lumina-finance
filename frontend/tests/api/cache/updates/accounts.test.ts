/**
 * Tests the cache write a recorded starting balance relies on, so the new account shows the balance
 * at once and the net worth and credit figures built on it don't keep the zero it was created with
 *
 * useRecordStartingBalance calls useMutation and useQueryClient, which need a live React tree, so
 * this covers applyRecordedStartingBalance directly against a real QueryClient
 */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { Account, AccountsOverview } from '@/api/accounts';
import { accountKeys, dashboardKeys } from '@/api/cache/queryKeys';
import { applyRecordedStartingBalance } from '@/api/cache/updates/accounts';

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
  };
}

describe('applyRecordedStartingBalance', () => {
  it('shows a card owing 400.00 at once and marks net worth and credit used stale', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(accountKeys.list(), [createCard(0)]);
    queryClient.setQueryData(dashboardKeys.netWorth(30), { points: [] });
    queryClient.setQueryData(dashboardKeys.credit(), { credit_used: 0 });

    applyRecordedStartingBalance(queryClient, createCard(-40000));

    const accounts = queryClient.getQueryData<AccountsOverview[]>(accountKeys.list());
    expect(accounts?.map((account) => account.current_balance)).toEqual([-40000]);
    expect(queryClient.getQueryState(dashboardKeys.netWorth(30))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(dashboardKeys.credit())?.isInvalidated).toBe(true);
  });
});
