/**
 * Covers transaction import API batching that splits large uploads before the hook uses it
 *
 * These tests catch regressions where import batches exceed the size budget,
 * or later batches fail to reuse account and category IDs created by earlier batches
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  TransactionImportPayload,
  TransactionImportResponse,
  TransactionImportRow,
} from '@/api/transaction-imports';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import { importTransactionsInBatches } from '@/api/transaction-imports';

/**
 * Builds a representative parsed import row used across batching scenarios
 */
function buildImportRow(notes = ''): TransactionImportRow {
  return {
    account_source: 'Checking',
    category_source: 'Groceries',
    dt: '2026-06-12',
    amount: '-42.50',
    merchant_name: 'Market',
    notes,
    tag_names: ['Food'],
  };
}

/**
 * Builds a valid import payload around the requested rows so tests can focus on batching behaviour
 */
function buildImportPayload(rows: TransactionImportRow[]): TransactionImportPayload {
  return {
    accounts: [
      {
        source: 'Checking',
        create: {
          name: 'Checking',
          account_type: 'checking',
          currency: 'CAD',
        },
      },
    ],
    categories: [
      {
        source: 'Groceries',
        create: {
          name: 'Groceries',
          kind: 'expense',
        },
      },
    ],
    rows,
  };
}

/**
 * Builds a complete backend import response with focused overrides for each assertion
 */
function buildImportResponse(
  overrides: Partial<TransactionImportResponse> = {},
): TransactionImportResponse {
  return {
    transactions_created: 0,
    accounts_created: 0,
    accounts_reused: 0,
    categories_created: 0,
    categories_reused: 0,
    merchants_created: 0,
    merchants_reused: 0,
    tags_created: 0,
    tags_reused: 0,
    affected_account_ids: [],
    account_source_ids: {},
    category_source_ids: {},
    created_account_ids: [],
    created_category_ids: [],
    created_merchant_ids: [],
    created_tag_ids: [],
    ...overrides,
  };
}

beforeEach(() => {
  authenticatedFetchMock.mockReset();
});

describe('transaction import batching', () => {
  it('uploads small imports in one batch', async () => {
    const payload = buildImportPayload([buildImportRow()]);
    const response = buildImportResponse({
      transactions_created: 1,
      affected_account_ids: ['acc_123'],
    });

    authenticatedFetchMock.mockResolvedValueOnce(response);

    await expect(importTransactionsInBatches(payload)).resolves.toMatchObject({
      transactions_created: 1,
      affected_account_ids: ['acc_123'],
    });
    expect(authenticatedFetchMock).toHaveBeenCalledWith('/transactions/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  });

  it('reuses source IDs created by earlier batches', async () => {
    const largeNotes = 'x'.repeat(400 * 1024);
    const payload = buildImportPayload([
      buildImportRow(largeNotes),
      buildImportRow(largeNotes),
    ]);
    const firstResponse = buildImportResponse({
      transactions_created: 1,
      accounts_created: 1,
      categories_created: 1,
      affected_account_ids: ['acc_created'],
      account_source_ids: { Checking: 'acc_created' },
      category_source_ids: { Groceries: 'cat_created' },
      created_account_ids: ['acc_created'],
      created_category_ids: ['cat_created'],
    });
    const secondResponse = buildImportResponse({
      transactions_created: 1,
      accounts_reused: 1,
      categories_reused: 1,
      affected_account_ids: ['acc_created'],
    });

    authenticatedFetchMock
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(secondResponse);

    const result = await importTransactionsInBatches(payload);
    const firstBatchPayload = JSON.parse(authenticatedFetchMock.mock.calls[0][1].body);
    const secondBatchPayload = JSON.parse(authenticatedFetchMock.mock.calls[1][1].body);

    expect(result).toMatchObject({
      transactions_created: 2,
      accounts_created: 1,
      accounts_reused: 1,
      categories_created: 1,
      categories_reused: 1,
      affected_account_ids: ['acc_created'],
      created_account_ids: ['acc_created'],
      created_category_ids: ['cat_created'],
    });
    expect(firstBatchPayload.accounts).toEqual(payload.accounts);
    expect(firstBatchPayload.categories).toEqual(payload.categories);
    expect(secondBatchPayload.accounts).toEqual([
      { source: 'Checking', account_id: 'acc_created' },
    ]);
    expect(secondBatchPayload.categories).toEqual([
      { source: 'Groceries', category_id: 'cat_created' },
    ]);
  });

  // A batch only carries the mappings for the sources its rows name, and the other side of a
  // transfer is named by no row's account, so it has to be collected from the transfer itself
  it('carries the mapping for a transfer other account no row is written to', async () => {
    const payload = buildImportPayload([
      { ...buildImportRow(), category_source: 'Transfer', other_account_source: 'Brokerage elsewhere' },
    ]);
    payload.categories = [{ source: 'Transfer', category_id: 'cat_transfer' }];
    payload.accounts = [...payload.accounts, { source: 'Brokerage elsewhere', outside: true }];

    authenticatedFetchMock.mockResolvedValueOnce(buildImportResponse({ transactions_created: 1 }));

    await importTransactionsInBatches(payload);
    const batchPayload = JSON.parse(authenticatedFetchMock.mock.calls[0][1].body);

    expect(batchPayload.accounts).toContainEqual({ source: 'Brokerage elsewhere', outside: true });
  });
});
