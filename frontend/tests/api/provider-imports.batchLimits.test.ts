/**
 * Covers the limits a staged provider batch is built against, so a batch the API would refuse is
 * never sent
 *
 * The mapping count is capped by the API. A batch closed on bytes alone would pass the byte budget
 * and fail the request on its mappings, and re-batching the same export would build the same batch,
 * so the upload could not recover. The byte budget itself is covered through the shared builder in
 * the transaction import tests
 */
import { describe, expect, it } from 'vitest';

import { buildJournalStageBatches } from '@/api/provider-imports';
import type {
  JournalImportPayload,
  JournalImportRow,
  JournalImportStageBatch,
} from '@/api/provider-imports';
import { MAX_IMPORT_BATCH_MAPPINGS } from '@/api/shared/importBatchSize';

// Notes long enough that a few dozen rows fill a batch's byte budget, far below any other limit
const LONG_NOTES = 'x'.repeat(10_000);

/**
 * Builds the index-th withdrawal from the imported chequing account, under the given category source
 */
function buildRow(index: number, categorySource = 'G', notes: string | null = null): JournalImportRow {
  return {
    journal_id: String(index),
    type: 'withdrawal',
    dt: '2026-06-12',
    amount: '1',
    currency_code: 'CAD',
    foreign_amount: null,
    foreign_currency_code: null,
    description: null,
    source_account: 'C',
    source_name: null,
    destination_account: null,
    destination_name: 'M',
    category: categorySource,
    tag_names: [],
    notes,
  };
}

/**
 * Builds a payload around the given rows, mapping every category source they name
 */
function buildPayload(rows: JournalImportRow[]): JournalImportPayload {
  const categorySources = [...new Set(rows.map((row) => row.category ?? ''))];
  return {
    accounts: [{ source: 'C', account_id: 'acc_1' }],
    categories: categorySources.map((source) => ({ source, create: { name: source, kind: 'expense' } })),
    rows,
  };
}

/**
 * Checks every row is staged exactly once, in order, each batch starting where the last one ended
 */
function expectEveryRowStagedOnceInOrder(batches: JournalImportStageBatch[], rows: JournalImportRow[]) {
  let expectedIndex = 0;
  for (const batch of batches) {
    expect(batch.start_row_index).toBe(expectedIndex);
    expectedIndex += batch.rows.length;
  }
  expect(batches.flatMap((batch) => batch.rows)).toEqual(rows);
}

describe('the limits a staged provider batch is built against', () => {
  it('closes a batch on the mapping count, not only on its bytes', async () => {
    // Every row introduces a category of its own, so the mappings fill up long before the bytes do
    const rows = Array.from({ length: MAX_IMPORT_BATCH_MAPPINGS + 50 }, (_, index) => buildRow(index, `Category ${index}`));

    const batches = await buildJournalStageBatches(buildPayload(rows));

    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(batch.categories.length).toBeLessThanOrEqual(MAX_IMPORT_BATCH_MAPPINGS);
    }
    expectEveryRowStagedOnceInOrder(batches, rows);
  });

  it('sends an account no row names with the first batch only, so it is created once', async () => {
    const rows = Array.from({ length: 200 }, (_, index) => buildRow(index, 'G', LONG_NOTES));
    const payload = buildPayload(rows);
    const emptyAccount = { source: 'E', account_id: 'acc_2' };
    payload.accounts.push(emptyAccount);

    const batches = await buildJournalStageBatches(payload);

    expect(batches.length).toBeGreaterThan(1);
    expect(batches[0].accounts).toContainEqual(emptyAccount);
    for (const batch of batches.slice(1)) {
      expect(batch.accounts).not.toContainEqual(emptyAccount);
    }
  });
});
