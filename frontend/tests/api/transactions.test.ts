/**
 * Covers transaction API fetch functions that build request paths before transaction hooks use them
 *
 * These tests catch regressions where filters, pagination,
 * or overview ranges are omitted from the expected endpoint
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import {
  fetchTransaction,
  fetchTransactionPage,
  fetchTransactions,
  fetchTransactionsOverview,
} from '@/api/transactions';

beforeEach(() => {
  authenticatedFetchMock.mockReset();
  authenticatedFetchMock.mockResolvedValue([]);
});

describe('transaction fetch functions', () => {
  it('requests transaction detail endpoints', async () => {
    await fetchTransaction('txn_123');

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/transactions/txn_123');
  });

  it('requests filtered transaction lists', async () => {
    await fetchTransactions({
      account_id: ['acc_123'],
      q: 'coffee shop',
      from_date: '2026-01-01',
      to_date: '2026-01-31',
      sort_by: 'dt',
      sort_order: 'desc',
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/transactions?account_id=acc_123&q=coffee+shop&from_date=2026-01-01&to_date=2026-01-31&sort_by=dt&sort_order=desc',
    );
  });

  it('omits empty transaction filters', async () => {
    await fetchTransactions({
      account_id: [],
      category_id: undefined,
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/transactions');
  });

  it('requests paginated transaction lists with offset options', async () => {
    await fetchTransactionPage({ category_id: ['cat_123'] }, 50, 100);

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/transactions?category_id=cat_123&limit=50&offset=100',
    );
  });

  it('requests transaction overview ranges', async () => {
    await fetchTransactionsOverview({
      from_date: '2026-02-01',
      to_date: '2026-02-28',
      account_id: 'acc_123',
    });

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/transactions/overview?from_date=2026-02-01&to_date=2026-02-28&account_id=acc_123',
    );
  });
});
