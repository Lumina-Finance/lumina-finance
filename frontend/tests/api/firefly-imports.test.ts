/**
 * Covers how a prepared Firefly III import is staged as a run and committed in one request
 *
 * These tests catch regressions where the budgets are written outside the run, where an upload that
 * stopped part way leaves a staged run behind, and where a failed commit drops the run it could
 * commit again
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/auth/errors';
import type {
  FireflyImportRunBudgets,
  FireflyTransactionImportPayload,
  FireflyTransactionImportRow,
} from '@/api/firefly-imports';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import { runFireflyImport } from '@/api/firefly-imports';
import { TransactionImportRunError } from '@/api/transaction-imports';

const RUN_ID = 'run_1';
const RUN_PATH = `/transactions/import/runs/${RUN_ID}`;

/** Builds one withdrawal from the imported chequing account, shaped as the screen sends it */
function buildRow(journalId: string): FireflyTransactionImportRow {
  return {
    journal_id: journalId,
    type: 'Withdrawal',
    dt: '2026-04-10',
    amount: '45.67',
    currency_code: 'CAD',
    foreign_amount: null,
    foreign_currency_code: null,
    description: 'Groceries',
    source_account: 'Everyday Chequing',
    source_name: null,
    destination_account: null,
    destination_name: 'Market',
    category: 'Groceries',
    tag_names: [],
    notes: null,
  };
}

const PAYLOAD: FireflyTransactionImportPayload = {
  accounts: [{ source: 'Everyday Chequing', create: { name: 'Everyday Chequing', account_type: 'checking', currency: 'CAD' } }],
  categories: [{ source: 'Groceries', create: { name: 'Groceries', kind: 'expense' } }],
  rows: [buildRow('1'), buildRow('2')],
};

const BUDGETS: FireflyImportRunBudgets = {
  categories: PAYLOAD.categories,
  budgets: [{
    name: 'Food',
    currency: 'CAD',
    category_sources: ['Groceries'],
    limits: [{ start: '2026-04-01', end: '2026-04-30', amount: '300' }],
    recurrence: null,
    is_archived: false,
  }],
};

/** Lists each request the import sent as its method and path */
function getRequests() {
  return authenticatedFetchMock.mock.calls.map(([path, init]) => `${init?.method ?? 'GET'} ${path}`);
}

describe('runFireflyImport', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset();
  });

  it('stages the rows, budgets and accounts to archive against one Firefly III run, then commits it once', async () => {
    const summary = { rows_imported: 2 };
    authenticatedFetchMock
      .mockResolvedValueOnce({ id: RUN_ID })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(summary);

    await expect(runFireflyImport({ payload: PAYLOAD, budgets: BUDGETS, archiveAccountSources: ['account-1'] }))
      .resolves.toBe(summary);

    expect(getRequests()).toEqual([
      'POST /transactions/import/runs',
      `POST ${RUN_PATH}/firefly/rows`,
      `PUT ${RUN_PATH}/budgets`,
      `PUT ${RUN_PATH}/archive`,
      `POST ${RUN_PATH}/firefly/commit`,
    ]);
    const [[, open], [, stage], [, budgets], [, archive]] = authenticatedFetchMock.mock.calls;
    expect(JSON.parse(open.body)).toEqual({ expected_transaction_count: 2, source: 'firefly' });
    expect(JSON.parse(stage.body)).toEqual({ ...PAYLOAD, start_row_index: 0 });
    expect(JSON.parse(budgets.body)).toEqual(BUDGETS);
    expect(JSON.parse(archive.body)).toEqual({ account_sources: ['account-1'] });
  });

  it('drops the run when the budgets are refused, so nothing is left staged', async () => {
    authenticatedFetchMock
      .mockResolvedValueOnce({ id: RUN_ID })
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError('Category not found', 422))
      .mockResolvedValueOnce(undefined);

    const error = await runFireflyImport({ payload: PAYLOAD, budgets: BUDGETS, archiveAccountSources: [] }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TransactionImportRunError);
    expect(error).toMatchObject({ phase: 'staging', runId: null, message: 'Category not found' });
    expect(getRequests().at(-1)).toBe(`DELETE ${RUN_PATH}`);
  });

  it('drops the run when the import is stopped as staging finishes', async () => {
    const controller = new AbortController();
    authenticatedFetchMock
      .mockResolvedValueOnce({ id: RUN_ID })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const error = await runFireflyImport({ payload: PAYLOAD, budgets: null, archiveAccountSources: [] }, controller.signal, async () => {
      controller.abort();
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ phase: 'staging', runId: null });
    expect(getRequests()).toEqual([
      'POST /transactions/import/runs',
      `POST ${RUN_PATH}/firefly/rows`,
      `DELETE ${RUN_PATH}`,
    ]);
  });

  it('keeps the run when the commit fails, so it can be committed again', async () => {
    authenticatedFetchMock
      .mockResolvedValueOnce({ id: RUN_ID })
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError('Request failed (503)', 503));

    const error = await runFireflyImport({ payload: PAYLOAD, budgets: null, archiveAccountSources: [] }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ phase: 'commit', runId: RUN_ID });
    expect(getRequests()).not.toContain(`DELETE ${RUN_PATH}`);
  });
});
