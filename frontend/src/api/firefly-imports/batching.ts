import {
  getFireflyRowAccountSources,
  getFireflyRowCategorySource,
} from '@/api/firefly-imports/rowSources';
import type {
  FireflyImportStageBatch,
  FireflyTransactionImportPayload,
  FireflyTransactionImportRow,
} from '@/api/firefly-imports/types';
import {
  IMPORT_BATCH_YIELD_INTERVAL,
  MAX_IMPORT_BATCH_BYTES,
  MAX_IMPORT_BATCH_MAPPINGS,
  MAX_IMPORT_BATCH_ROWS,
  TARGET_IMPORT_BATCH_BYTES,
  getEmptyImportPayloadByteSize,
  getNextArrayItemByteSize,
  yieldToBrowser,
} from '@/api/shared/importBatchSize';

/**
 * Splits a prepared Firefly III import into batches that each fit the request-size budget
 *
 * Nothing is created while an export is staged, so a batch carries the mappings its own rows
 * reference exactly as they were prepared, and no batch depends on what an earlier one returned.
 * An account no row names, which the import creates empty, rides with the first batch, since the
 * server only takes a batch that holds rows
 */
export async function buildFireflyStageBatches(
  payload: FireflyTransactionImportPayload,
): Promise<FireflyImportStageBatch[]> {
  const accountMappingsBySource = new Map(payload.accounts.map((mapping) => [mapping.source, mapping]));
  const categoryMappingsBySource = new Map(payload.categories.map((mapping) => [mapping.source, mapping]));
  const rowAccountSources = new Set(payload.rows.flatMap((row) => getFireflyRowAccountSources(row)));
  const rowlessAccountSources = payload.accounts
    .map((mapping) => mapping.source)
    .filter((source) => !rowAccountSources.has(source));
  const batches: FireflyImportStageBatch[] = [];
  let rowIndex = 0;

  while (rowIndex < payload.rows.length) {
    const batch = await buildNextStageBatch(
      payload.rows,
      rowIndex,
      rowIndex === 0 ? rowlessAccountSources : [],
      accountMappingsBySource,
      categoryMappingsBySource,
    );
    batches.push(batch.payload);
    rowIndex = batch.nextRowIndex;
  }

  return batches;
}

/**
 * Builds the next batch without exceeding the request-size budget
 */
async function buildNextStageBatch(
  sourceRows: FireflyTransactionImportRow[],
  startIndex: number,
  rowlessAccountSources: string[],
  accountMappingsBySource: Map<string, FireflyTransactionImportPayload['accounts'][number]>,
  categoryMappingsBySource: Map<string, FireflyTransactionImportPayload['categories'][number]>,
) {
  const rows: FireflyTransactionImportRow[] = [];
  const accountSources = new Set<string>();
  const categorySources = new Set<string>();
  let estimatedBytes = getEmptyImportPayloadByteSize();
  let rowIndex = startIndex;

  for (const source of rowlessAccountSources) {
    estimatedBytes += getNextMappingByteSize(source, accountSources, accountMappingsBySource, 'Account');
    accountSources.add(source);
  }

  // Each row may introduce account and category mappings, so the batch budget tracks both
  while (rowIndex < sourceRows.length) {
    const row = sourceRows[rowIndex];
    const rowAccountSources = getFireflyRowAccountSources(row);
    const categorySource = getFireflyRowCategorySource(row);
    const rowCategorySources = categorySource === null ? [] : [categorySource];

    let nextEstimatedBytes = estimatedBytes + getNextArrayItemByteSize(rows.length, row);
    for (const source of rowCategorySources) {
      nextEstimatedBytes += getNextMappingByteSize(source, categorySources, categoryMappingsBySource, 'Category');
    }
    for (const source of rowAccountSources) {
      nextEstimatedBytes += getNextMappingByteSize(source, accountSources, accountMappingsBySource, 'Account');
    }

    // Mappings are small enough that an export with many distinct values fills the count long
    // before it fills the byte budget, so both are what closes a batch
    const isBatchFull = nextEstimatedBytes > TARGET_IMPORT_BATCH_BYTES
      || rows.length >= MAX_IMPORT_BATCH_ROWS
      || countWithNewSources(accountSources, rowAccountSources) > MAX_IMPORT_BATCH_MAPPINGS
      || countWithNewSources(categorySources, rowCategorySources) > MAX_IMPORT_BATCH_MAPPINGS;

    if (rows.length > 0 && isBatchFull) break;
    if (rows.length === 0 && nextEstimatedBytes > MAX_IMPORT_BATCH_BYTES) {
      throw new Error('One imported row is too large to upload safely.');
    }

    rows.push(row);
    for (const source of rowAccountSources) accountSources.add(source);
    for (const source of rowCategorySources) categorySources.add(source);
    estimatedBytes = nextEstimatedBytes;
    rowIndex += 1;

    if ((rowIndex - startIndex) % IMPORT_BATCH_YIELD_INTERVAL === 0) {
      await yieldToBrowser();
    }
  }

  if (rows.length === 0) throw new Error('No import rows are available to upload.');

  // The server takes at least one account mapping per batch, and every row the browser uploads
  // writes to an account, so a batch without one means a row that should have been left out
  if (accountSources.size === 0) throw new Error('An import batch writes to no account.');

  return {
    payload: {
      accounts: [...accountSources].map((source) => getMapping(source, accountMappingsBySource, 'Account')),
      categories: [...categorySources].map((source) => getMapping(source, categoryMappingsBySource, 'Category')),
      rows,
      start_row_index: startIndex,
    },
    nextRowIndex: rowIndex,
  };
}

/**
 * Counts what a set would hold once the given sources were added to it
 */
function countWithNewSources(sources: Set<string>, candidates: string[]) {
  const added = new Set(candidates.filter((source) => !sources.has(source)));
  return sources.size + added.size;
}

/**
 * Returns the mapping for a source the payload must already carry
 */
function getMapping<T>(source: string, mappingsBySource: Map<string, T>, label: string): T {
  const mapping = mappingsBySource.get(source);
  if (!mapping) throw new Error(`${label} source is not mapped: ${source}`);
  return mapping;
}

/**
 * Estimates the bytes a source adds to a batch that does not carry it yet
 */
function getNextMappingByteSize<T>(source: string, sources: Set<string>, mappingsBySource: Map<string, T>, label: string) {
  if (sources.has(source)) return 0;
  return getNextArrayItemByteSize(sources.size, getMapping(source, mappingsBySource, label));
}
