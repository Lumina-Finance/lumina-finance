/**
 * Covers the limits a staged batch is built against, so a batch the API would refuse is never sent
 *
 * The row count and the mapping count are both capped by the API. A batch closed on bytes alone
 * would pass the byte budget and fail the request, and re-batching the same payload would build the
 * same batch, so the upload could not recover
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_IMPORT_BATCH_MAPPINGS,
  MAX_IMPORT_BATCH_ROWS,
} from '@/api/shared/importBatchSize';
import { buildStagedImportBatches } from '@/api/transaction-imports';
import type {
  TransactionImportPayload,
  TransactionImportRow,
} from '@/api/transaction-imports';

/**
 * Builds one row, optionally against a category source of its own
 *
 * Field values are as short as the shapes allow, so the byte budget stays out of the way of the
 * row-count cap. A row of ordinary size fills the bytes first, which is what makes the count the
 * condition that only bites on unusually small rows
 */
function buildRow(categorySource = 'G'): TransactionImportRow {
  return {
    account_source: 'C',
    category_source: categorySource,
    dt: '2026-06-12',
    amount: '-1',
    merchant_name: null,
    notes: '',
    tag_names: [],
  };
}

/**
 * Builds a payload carrying one row per category source given
 */
function buildPayload(categorySources: string[]): TransactionImportPayload {
  return {
    accounts: [{ source: 'C', account_id: 'acc_1' }],
    categories: categorySources.map((source) => ({
      source,
      create: { name: source, kind: 'expense' },
    })),
    merchants: [],
    rows: categorySources.map((source) => buildRow(source)),
  };
}

describe('the payee answers a staged batch carries', () => {
  it('carries only the values the user answered, and no batch looks up one they did not', async () => {
    const payload: TransactionImportPayload = {
      accounts: [{ source: 'C', account_id: 'acc_1' }],
      categories: [{ source: 'G', category_id: 'cat_1' }],
      merchants: [{ source: 'SQ *COFFEE 4471', create: { name: 'Coffee Bar' } }],
      rows: [
        { ...buildRow(), merchant_name: 'SQ *COFFEE 4471' },
        // Spelled differently, so it is found by what matches a payee rather than by the spelling
        { ...buildRow(), merchant_name: 'sq *coffee 4471' },
        // Never answered, so the batch carries nothing for it rather than failing to find one
        { ...buildRow(), merchant_name: 'Bakery' },
      ],
    };

    const batches = await buildStagedImportBatches(payload);

    expect(batches).toHaveLength(1);
    expect(batches[0].merchants).toEqual([{ source: 'SQ *COFFEE 4471', create: { name: 'Coffee Bar' } }]);
  });
});

describe('the limits a staged batch is built against', () => {
  it('closes a batch on the mapping count, not only on its bytes', async () => {
    // Every row introduces a category of its own, so the mappings fill up long before the bytes do
    const sources = Array.from({ length: MAX_IMPORT_BATCH_MAPPINGS + 50 }, (_, index) => `Category ${index}`);

    const batches = await buildStagedImportBatches(buildPayload(sources));

    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(batch.categories.length).toBeLessThanOrEqual(MAX_IMPORT_BATCH_MAPPINGS);
      expect(batch.accounts.length).toBeLessThanOrEqual(MAX_IMPORT_BATCH_MAPPINGS);
    }
  });

  it('closes a batch on the row count where the rows are small enough to fit more', async () => {
    // Rows this small all share one mapping and stay well inside the byte budget, so the row count
    // is the only condition that can close the batch. An ordinary row fills the bytes first
    const payload: TransactionImportPayload = {
      accounts: [{ source: 'C', account_id: 'acc_1' }],
      categories: [{ source: 'G', category_id: 'cat_1' }],
      merchants: [],
      rows: Array.from({ length: MAX_IMPORT_BATCH_ROWS + 100 }, () => buildRow()),
    };

    const batches = await buildStagedImportBatches(payload);

    expect(batches[0].rows).toHaveLength(MAX_IMPORT_BATCH_ROWS);
    expect(batches).toHaveLength(2);
    for (const batch of batches) {
      expect(batch.rows.length).toBeLessThanOrEqual(MAX_IMPORT_BATCH_ROWS);
    }
  });

  it('stages every row exactly once, in order', async () => {
    const sources = Array.from({ length: MAX_IMPORT_BATCH_MAPPINGS + 50 }, (_, index) => `Category ${index}`);

    const batches = await buildStagedImportBatches(buildPayload(sources));

    let expectedIndex = 0;
    for (const batch of batches) {
      expect(batch.start_row_index).toBe(expectedIndex);
      expectedIndex += batch.rows.length;
    }
    expect(expectedIndex).toBe(sources.length);
  });
});
