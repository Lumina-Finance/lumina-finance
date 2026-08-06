/**
 * Covers how a prepared import is staged and committed, before the hook uses it
 *
 * These tests catch regressions where staged batches exceed the request-size budget, where a batch
 * loses the mappings its rows reference, and where an upload that stopped part way leaves a staged
 * run behind instead of dropping it
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/auth/errors';
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

import {
  TransactionImportRunError,
  isImportCommitWorthRepeating,
  runTransactionImport,
} from '@/api/transaction-imports';

const RUN_ID = 'run_1';

/**
 * Builds a representative parsed import row used across staging scenarios
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
 * Builds a valid import payload around the requested rows so tests can focus on staging behaviour
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

/**
 * Answers the run-opening call, then every staging call, then the commit
 */
function mockRunCalls(commitResult: TransactionImportResponse | Error, stagedBatchCount = 1) {
  authenticatedFetchMock.mockResolvedValueOnce({ id: RUN_ID });
  for (let index = 0; index < stagedBatchCount; index += 1) {
    authenticatedFetchMock.mockResolvedValueOnce(undefined);
  }
  if (commitResult instanceof Error) {
    authenticatedFetchMock.mockRejectedValueOnce(commitResult);
  } else {
    authenticatedFetchMock.mockResolvedValueOnce(commitResult);
  }
}

/**
 * Returns the paths every call was made against, in order
 */
function calledPaths() {
  return authenticatedFetchMock.mock.calls.map((call) => call[0]);
}

/**
 * Returns the body of the call at one position, parsed back into the object that was sent
 */
function sentBody(callIndex: number) {
  return JSON.parse(authenticatedFetchMock.mock.calls[callIndex][1].body);
}

beforeEach(() => {
  authenticatedFetchMock.mockReset();
});

describe('staging a transaction import', () => {
  it('opens a run, stages a small import in one batch and commits it', async () => {
    const payload = buildImportPayload([buildImportRow()]);
    mockRunCalls(buildImportResponse({ transactions_created: 1, affected_account_ids: ['acc_123'] }));

    await expect(runTransactionImport(payload)).resolves.toMatchObject({
      transactions_created: 1,
      affected_account_ids: ['acc_123'],
    });
    expect(calledPaths()).toEqual([
      '/transactions/import/runs',
      `/transactions/import/runs/${RUN_ID}/rows`,
      `/transactions/import/runs/${RUN_ID}/commit`,
    ]);
    expect(sentBody(0)).toEqual({ expected_transaction_count: 1 });
    expect(sentBody(1)).toMatchObject({
      accounts: payload.accounts,
      categories: payload.categories,
      rows: payload.rows,
      start_row_index: 0,
    });
  });

  it('carries each batch its own mappings and its place in the file', async () => {
    const largeNotes = 'x'.repeat(400 * 1024);
    const payload = buildImportPayload([buildImportRow(largeNotes), buildImportRow(largeNotes)]);
    mockRunCalls(buildImportResponse({ transactions_created: 2 }), 2);

    await runTransactionImport(payload);

    expect(calledPaths()).toHaveLength(4);
    expect(sentBody(1)).toMatchObject({ accounts: payload.accounts, start_row_index: 0 });
    expect(sentBody(1).rows).toHaveLength(1);

    // Nothing is created while a file is staged, so the second batch repeats the create mapping
    // rather than quoting an id the first batch came back with
    expect(sentBody(2)).toMatchObject({ accounts: payload.accounts, start_row_index: 1 });
    expect(sentBody(2).rows).toHaveLength(1);
  });

  // A batch only carries the mappings for the sources its rows use, and a counterparty belongs to
  // no row's own account, so it has to be collected from the transfer itself
  it('carries the mapping for a counterparty no row is written to', async () => {
    const payload = buildImportPayload([
      { ...buildImportRow(), category_source: 'Transfer', counterparty_account_source: 'Brokerage elsewhere' },
    ]);
    payload.categories = [{ source: 'Transfer', category_id: 'cat_transfer' }];
    payload.accounts = [...payload.accounts, { source: 'Brokerage elsewhere', outside: true }];
    mockRunCalls(buildImportResponse({ transactions_created: 1 }));

    await runTransactionImport(payload);

    expect(sentBody(1).accounts).toContainEqual({ source: 'Brokerage elsewhere', outside: true });
  });

  it('drops the run when a batch fails, so nothing is left staged', async () => {
    const payload = buildImportPayload([buildImportRow()]);
    authenticatedFetchMock
      .mockResolvedValueOnce({ id: RUN_ID })
      .mockRejectedValueOnce(new ApiError('Account is archived', 422))
      .mockResolvedValueOnce(undefined);

    await expect(runTransactionImport(payload)).rejects.toBeInstanceOf(TransactionImportRunError);

    expect(calledPaths()).toEqual([
      '/transactions/import/runs',
      `/transactions/import/runs/${RUN_ID}/rows`,
      `/transactions/import/runs/${RUN_ID}`,
    ]);
    expect(authenticatedFetchMock.mock.calls[2][1].method).toBe('DELETE');
  });

  it('keeps the run when the commit fails, so it can be committed again', async () => {
    const payload = buildImportPayload([buildImportRow()]);
    mockRunCalls(new ApiError('Request failed (503)', 503));

    const error = await runTransactionImport(payload).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(TransactionImportRunError);
    expect((error as TransactionImportRunError).phase).toBe('commit');
    expect((error as TransactionImportRunError).runId).toBe(RUN_ID);
    expect(isImportCommitWorthRepeating(error)).toBe(true);
    expect(calledPaths()).not.toContain(`/transactions/import/runs/${RUN_ID}`);
  });

  it('does not offer to commit again when the file itself was refused', async () => {
    const payload = buildImportPayload([buildImportRow()]);
    mockRunCalls(new ApiError('Invalid amount: $2.00', 422));

    const error = await runTransactionImport(payload).catch((thrown: unknown) => thrown);

    expect(isImportCommitWorthRepeating(error)).toBe(false);
  });
});
