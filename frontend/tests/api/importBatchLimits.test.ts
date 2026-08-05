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
 */
function buildRow(categorySource = 'Groceries'): TransactionImportRow {
  return {
    account_source: 'Checking',
    category_source: categorySource,
    dt: '2026-06-12',
    amount: '-42.50',
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
    accounts: [{ source: 'Checking', account_id: 'acc_1' }],
    categories: categorySources.map((source) => ({
      source,
      create: { name: source, kind: 'expense' },
    })),
    rows: categorySources.map((source) => buildRow(source)),
  };
}

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

  it('keeps every batch inside the row count the API accepts', async () => {
    // Rows sharing one category are as small as a batch gets, which is what puts the row count
    // closest to its cap
    const payload: TransactionImportPayload = {
      accounts: [{ source: 'Checking', account_id: 'acc_1' }],
      categories: [{ source: 'Groceries', category_id: 'cat_1' }],
      rows: Array.from({ length: MAX_IMPORT_BATCH_ROWS * 2 }, () => buildRow()),
    };

    const batches = await buildStagedImportBatches(payload);

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
