/**
 * Covers account API fetch functions that build request paths before account hooks use them
 *
 * These tests catch regressions where account IDs, snapshot options,
 * spending ranges, or cash-flow windows are not encoded into the expected endpoint
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import {
  fetchAccount,
  fetchAccountCashFlow,
  fetchAccountSnapshots,
  fetchAccountSpendingBreakdown,
  fetchAccounts,
} from '@/api/accounts';

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  authenticatedFetchMock.mockResolvedValue([]);
});

describe('account fetch functions', () => {
  it('requests account list and detail endpoints', async () => {
    await fetchAccounts();
    await fetchAccount('acc_123');

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(1, '/accounts');
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(2, '/accounts/acc_123');
  });

  it('requests account snapshots with default options', async () => {
    await fetchAccountSnapshots('acc_123');

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/accounts/acc_123/snapshots');
  });

  it('requests account snapshots with encoded range options', async () => {
    await fetchAccountSnapshots('acc_123', {
      fromDate: '2026-01-01',
      toDate: '2026-06-12',
      granularity: 'month',
      includeAnchor: true,
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/accounts/acc_123/snapshots?from_date=2026-01-01&to_date=2026-06-12&granularity=month&include_anchor=true',
    );
  });

  it('requests account spending and cash-flow endpoints with encoded options', async () => {
    await fetchAccountSpendingBreakdown('acc_123', 'MTD');
    await fetchAccountCashFlow('acc_123', 12);

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      1,
      '/accounts/acc_123/spending-breakdown?range=MTD',
    );
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(
      2,
      '/accounts/acc_123/cash-flow?months=12',
    );
  });
});
