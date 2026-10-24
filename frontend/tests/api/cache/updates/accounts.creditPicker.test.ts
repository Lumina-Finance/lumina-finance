/**
 * Covers refreshing the dashboard credit widget's account list after a card is renamed or moved to
 * another institution, so the chooser never shows the old name or logo, while totals that neither
 * change can change are not fetched again
 */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { AccountsOverview } from '@/api/accounts';
import { dashboardKeys } from '@/api/cache/queryKeys';
import { invalidateAccountCreditPicker } from '@/api/cache/updates/accounts';

type PickerFields = Pick<AccountsOverview, 'account_kind' | 'name' | 'institution'>;

const BANK = { id: 'bank-1', name: 'Test Bank' } as AccountsOverview['institution'];
const OTHER_BANK = { id: 'bank-2', name: 'Other Bank' } as AccountsOverview['institution'];
const CARD: PickerFields = { account_kind: 'revolving', name: 'Visa', institution: BANK };

function createClient(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(dashboardKeys.credit(), {});
  client.setQueryData(dashboardKeys.creditUtilization(), {});
  return client;
}

describe('credit data after an account is updated', () => {
  it.each([
    { change: 'renamed', updated: { ...CARD, name: 'Visa Infinite' } },
    { change: 'moved to another institution', updated: { ...CARD, institution: OTHER_BANK } },
    { change: 'left with no institution', updated: { ...CARD, institution: null } },
  ])('refreshes only the widget account list for a revolving account $change', ({ updated }) => {
    const client = createClient();

    invalidateAccountCreditPicker(client, CARD, updated);

    expect(client.getQueryState(dashboardKeys.creditUtilization())?.isInvalidated).toBe(true);
    expect(client.getQueryState(dashboardKeys.credit())?.isInvalidated).toBe(false);
  });

  it('leaves the account list alone when neither the name nor the institution changed', () => {
    const client = createClient();

    invalidateAccountCreditPicker(client, CARD, { ...CARD });

    expect(client.getQueryState(dashboardKeys.creditUtilization())?.isInvalidated).toBe(false);
  });

  it('leaves credit data alone for other account kinds', () => {
    const client = createClient();
    const asset: PickerFields = { ...CARD, account_kind: 'asset' };

    invalidateAccountCreditPicker(client, asset, { ...asset, name: 'Savings' });

    expect(client.getQueryState(dashboardKeys.creditUtilization())?.isInvalidated).toBe(false);
  });
});
