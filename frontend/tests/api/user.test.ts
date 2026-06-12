/**
 * Covers user API functions that map runway settings between backend and frontend shapes
 *
 * These tests catch regressions where runway account IDs or threshold fields
 * are sent with the wrong names or returned without normalization
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import {
  fetchRunway,
  fetchRunwayAccounts,
  fetchRunwaySettings,
  updateRunwayAccounts,
  updateRunwaySettings,
} from '@/api/user';

const fxStatus = {
  state: 'none' as const,
  missing_pairs: [],
};

beforeEach(() => {
  authenticatedFetchMock.mockReset();
});

describe('user runway API functions', () => {
  it('requests and updates runway accounts with backend field names', async () => {
    authenticatedFetchMock.mockResolvedValueOnce(['acc_123']);

    await expect(fetchRunwayAccounts()).resolves.toEqual(['acc_123']);
    await updateRunwayAccounts(['acc_123', 'acc_456']);

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(1, '/me/runway-accounts');
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(2, '/me/runway-accounts', {
      method: 'PUT',
      body: JSON.stringify({ account_ids: ['acc_123', 'acc_456'] }),
    });
  });

  it('normalizes runway settings responses', async () => {
    authenticatedFetchMock.mockResolvedValueOnce({
      account_ids: ['acc_123'],
      archived_account_ids: ['acc_archived'],
      thresholds: {
        risky_below_months: 2,
        healthy_at_months: 6,
      },
    });

    await expect(fetchRunwaySettings()).resolves.toEqual({
      accountIds: ['acc_123'],
      archivedAccountIds: ['acc_archived'],
      thresholds: {
        riskyBelowMonths: 2,
        healthyAtMonths: 6,
      },
    });
  });

  it('updates runway settings with backend threshold field names', async () => {
    authenticatedFetchMock.mockResolvedValueOnce({
      account_ids: ['acc_123'],
      archived_account_ids: [],
      thresholds: {
        risky_below_months: 2,
        healthy_at_months: 6,
      },
    });

    await expect(updateRunwaySettings({
      accountIds: ['acc_123'],
      thresholds: {
        riskyBelowMonths: 2.2,
        healthyAtMonths: 6.1,
      },
    })).resolves.toMatchObject({
      accountIds: ['acc_123'],
      thresholds: {
        riskyBelowMonths: 2,
        healthyAtMonths: 6,
      },
    });
    expect(authenticatedFetchMock).toHaveBeenCalledWith('/me/runway-settings', {
      method: 'PUT',
      body: JSON.stringify({
        account_ids: ['acc_123'],
        thresholds: {
          risky_below_months: 2,
          healthy_at_months: 6,
        },
      }),
    });
  });

  it('normalizes runway result thresholds', async () => {
    authenticatedFetchMock.mockResolvedValueOnce({
      months: 4,
      reason: null,
      avg_monthly_expense: 300000,
      months_covered: 12,
      liquid_balance: 1200000,
      account_balances: [{ account_id: 'acc_123', balance: 1200000 }],
      thresholds: {
        risky_below_months: 1,
        healthy_at_months: 3,
      },
      fx_status: fxStatus,
    });

    await expect(fetchRunway()).resolves.toMatchObject({
      months: 4,
      thresholds: {
        riskyBelowMonths: 1,
        healthyAtMonths: 3,
      },
      fx_status: fxStatus,
    });
    expect(authenticatedFetchMock).toHaveBeenCalledWith('/me/runway');
  });
});
