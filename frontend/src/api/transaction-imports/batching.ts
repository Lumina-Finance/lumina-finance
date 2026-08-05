import {
  IMPORT_BATCH_YIELD_INTERVAL,
  MAX_IMPORT_BATCH_BYTES,
  TARGET_IMPORT_BATCH_BYTES,
  getEmptyImportPayloadByteSize,
  getNextArrayItemByteSize,
  yieldToBrowser,
} from '@/api/shared/importBatchSize';
import type {
  TransactionImportAccountMapping,
  TransactionImportCategoryMapping,
  TransactionImportPayload,
  TransactionImportRow,
  TransactionImportStageBatch,
} from '@/api/transaction-imports/types';

/**
 * Splits a prepared import into batches that each fit the request-size budget
 *
 * Nothing is created while a file is staged, so a batch carries the mappings its own rows
 * reference exactly as they were prepared, and no batch depends on what an earlier one returned
 */
export async function buildStagedImportBatches(
  payload: TransactionImportPayload,
): Promise<TransactionImportStageBatch[]> {
  const accountMappingsBySource = getImportMappingsBySource(payload.accounts);
  const categoryMappingsBySource = getImportMappingsBySource(payload.categories);
  const batches: TransactionImportStageBatch[] = [];
  let rowIndex = 0;

  while (rowIndex < payload.rows.length) {
    const batch = await buildNextStagedBatch(
      payload.rows,
      rowIndex,
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
async function buildNextStagedBatch(
  sourceRows: TransactionImportRow[],
  startIndex: number,
  accountMappingsBySource: Map<string, TransactionImportAccountMapping>,
  categoryMappingsBySource: Map<string, TransactionImportCategoryMapping>,
) {
  const rows: TransactionImportRow[] = [];
  const accountSources = new Set<string>();
  const categorySources = new Set<string>();
  let estimatedBytes = getEmptyImportPayloadByteSize();
  let rowIndex = startIndex;

  // Each row may introduce account and category mappings, so the batch budget tracks both
  while (rowIndex < sourceRows.length) {
    const row = sourceRows[rowIndex];
    let nextEstimatedBytes = estimatedBytes
      + getNextArrayItemByteSize(rows.length, row)
      + getNextMappingByteSize(row.category_source, categorySources, categoryMappingsBySource, 'Category');
    for (const source of getRowAccountSources(row)) {
      nextEstimatedBytes += getNextMappingByteSize(source, accountSources, accountMappingsBySource, 'Account');
    }

    if (rows.length > 0 && nextEstimatedBytes > TARGET_IMPORT_BATCH_BYTES) break;
    if (rows.length === 0 && nextEstimatedBytes > MAX_IMPORT_BATCH_BYTES) {
      throw new Error('One imported row is too large to upload safely.');
    }

    rows.push(row);
    for (const source of getRowAccountSources(row)) accountSources.add(source);
    categorySources.add(row.category_source);
    estimatedBytes = nextEstimatedBytes;
    rowIndex += 1;

    if ((rowIndex - startIndex) % IMPORT_BATCH_YIELD_INTERVAL === 0) {
      await yieldToBrowser();
    }
  }

  if (rows.length === 0) throw new Error('No import rows are available to upload.');

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
 * Lists every account mapping source one row references
 *
 * The counterparty account of a transfer is one of them, even though no row in the batch is
 * written to it
 */
function getRowAccountSources(row: TransactionImportRow) {
  return row.counterparty_account_source
    ? [row.account_source, row.counterparty_account_source]
    : [row.account_source];
}

function getImportMappingsBySource<T extends { source: string }>(mappings: T[]) {
  return new Map(mappings.map((mapping) => [mapping.source, mapping]));
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
function getNextMappingByteSize<T>(
  source: string,
  sources: Set<string>,
  mappingsBySource: Map<string, T>,
  label: string,
) {
  if (sources.has(source)) return 0;
  return getNextArrayItemByteSize(sources.size, getMapping(source, mappingsBySource, label));
}
