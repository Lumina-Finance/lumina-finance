/**
 * Covers refreshing the dashboard credit widget's account list after a card is renamed, so the chooser
 * never shows the old name, while totals that a rename can't change are not fetched again
 */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { dashboardKeys } from '@/api/cache/queryKeys';
import { invalidateAccountCreditName } from '@/api/cache/updates/accounts';

function createClient(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(dashboardKeys.credit(), {});
  client.setQueryData(dashboardKeys.creditUtilization(), {});
  return client;
}

describe('credit data after an account is renamed', () => {
  it('refreshes only the widget account list for a revolving account', () => {
    const client = createClient();

    invalidateAccountCreditName(client, { account_kind: 'revolving' });

    expect(client.getQueryState(dashboardKeys.creditUtilization())?.isInvalidated).toBe(true);
    expect(client.getQueryState(dashboardKeys.credit())?.isInvalidated).toBe(false);
  });

  it('leaves credit data alone for other account kinds', () => {
    const client = createClient();

    invalidateAccountCreditName(client, { account_kind: 'asset' });

    expect(client.getQueryState(dashboardKeys.creditUtilization())?.isInvalidated).toBe(false);
  });
});
