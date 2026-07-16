import { postFireflyTransactionImportBatch } from '@/api/fireflyImports/requests';
import {
  getFireflyRowAccountSources,
  getFireflyRowCategorySource,
} from '@/api/fireflyImports/rowSources';
import type {
  FireflyTransactionImportPayload,
  FireflyTransactionImportResponse,
  FireflyTransactionImportRow,
} from '@/api/fireflyImports/types';
import type {
  TransactionImportAccountMapping,
  TransactionImportCategoryMapping,
} from '@/api/transactionImports/types';

const MAX_IMPORT_BATCH_BYTES = 750 * 1024;
const TARGET_IMPORT_BATCH_BYTES = 650 * 1024;
const IMPORT_BATCH_YIELD_INTERVAL = 250;
const IMPORT_PAYLOAD_ENCODER = new TextEncoder();

/**
 * Uploads Firefly III imports in bounded batches that preserve backend-created source mappings
 */
export async function importFireflyTransactionsInBatches(payload: FireflyTransactionImportPayload) {
  const accountMappingsBySource = getImportMappingsBySource(payload.accounts);
  const categoryMappingsBySource = getImportMappingsBySource(payload.categories);
  const accountSourceIds: Record<string, string> = {};
  const categorySourceIds: Record<string, string> = {};
  const result = getEmptyImportResponse();
  let rowIndex = 0;

  // Later batches must reuse account and category IDs created by earlier batches
  while (rowIndex < payload.rows.length) {
    const batch = await buildNextImportBatch(
      payload,
      rowIndex,
      accountMappingsBySource,
      categoryMappingsBySource,
      accountSourceIds,
      categorySourceIds,
    );
    rowIndex = batch.nextRowIndex;
    const batchResult = await postFireflyTransactionImportBatch(batch.payload);
    mergeImportResponse(result, batchResult);
    Object.assign(accountSourceIds, batchResult.account_source_ids);
    Object.assign(categorySourceIds, batchResult.category_source_ids);
  }

  return result;
}

/**
 * Builds the next import batch without exceeding the request-size budget
 */
async function buildNextImportBatch(
  payload: FireflyTransactionImportPayload,
  startIndex: number,
  accountMappingsBySource: Map<string, TransactionImportAccountMapping>,
  categoryMappingsBySource: Map<string, TransactionImportCategoryMapping>,
  accountSourceIds: Record<string, string>,
  categorySourceIds: Record<string, string>,
) {
  const sourceRows = payload.rows;
  const rows: FireflyTransactionImportRow[] = [];
  const accountSources = new Set<string>();
  const categorySources = new Set<string>();
  let estimatedBytes = getEmptyImportPayloadByteSize();
  let rowIndex = startIndex;

  // Each row may introduce up to two account mappings plus a category mapping,
  // so the batch budget tracks all of them
  while (rowIndex < sourceRows.length) {
    const row = sourceRows[rowIndex];
    const rowAccountSources = getFireflyRowAccountSources(row);
    const rowCategorySource = getFireflyRowCategorySource(row);
    let nextEstimatedBytes = estimatedBytes
      + getNextArrayItemByteSize(rows.length, row)
      + getNextCategoryMappingByteSize(
        rowCategorySource,
        categorySources,
        categoryMappingsBySource,
        categorySourceIds,
      );
    for (const source of rowAccountSources) {
      nextEstimatedBytes += getNextAccountMappingByteSize(
        source,
        accountSources,
        accountMappingsBySource,
        accountSourceIds,
      );
    }

    if (rows.length > 0 && nextEstimatedBytes > TARGET_IMPORT_BATCH_BYTES) break;
    if (rows.length === 0 && nextEstimatedBytes > MAX_IMPORT_BATCH_BYTES) {
      throw new Error('One imported row is too large to upload safely.');
    }

    rows.push(row);
    for (const source of rowAccountSources) accountSources.add(source);
    categorySources.add(rowCategorySource);
    estimatedBytes = nextEstimatedBytes;
    rowIndex += 1;

    if ((rowIndex - startIndex) % IMPORT_BATCH_YIELD_INTERVAL === 0) {
      await yieldToBrowser();
    }
  }

  if (rows.length === 0) throw new Error('No import rows are available to upload.');

  // The endpoint requires at least one account mapping per request, so a batch
  // made entirely of rows without tracked endpoints borrows one known mapping
  if (accountSources.size === 0 && payload.accounts.length > 0) {
    accountSources.add(payload.accounts[0].source);
  }

  return {
    payload: buildImportBatchPayload(
      rows,
      [...accountSources],
      [...categorySources],
      accountMappingsBySource,
      categoryMappingsBySource,
      accountSourceIds,
      categorySourceIds,
    ),
    nextRowIndex: rowIndex,
  };
}

/**
 * Builds the backend payload for one bounded import batch
 */
function buildImportBatchPayload(
  rows: FireflyTransactionImportRow[],
  accountSources: string[],
  categorySources: string[],
  accountMappingsBySource: Map<string, TransactionImportAccountMapping>,
  categoryMappingsBySource: Map<string, TransactionImportCategoryMapping>,
  accountSourceIds: Record<string, string>,
  categorySourceIds: Record<string, string>,
): FireflyTransactionImportPayload {
  return {
    accounts: accountSources.map((source) =>
      getBatchAccountMapping(source, accountMappingsBySource, accountSourceIds),
    ),
    categories: categorySources.map((source) =>
      getBatchCategoryMapping(source, categoryMappingsBySource, categorySourceIds),
    ),
    rows,
  };
}

/**
 * Resolves an account source to either an existing backend ID or a create mapping
 */
function getBatchAccountMapping(
  source: string,
  mappingsBySource: Map<string, TransactionImportAccountMapping>,
  sourceIds: Record<string, string>,
): TransactionImportAccountMapping {
  const accountId = sourceIds[source];
  if (accountId) return { source, account_id: accountId };

  const mapping = mappingsBySource.get(source);
  if (!mapping) throw new Error(`Account source is not mapped: ${source}`);
  return mapping;
}

/**
 * Resolves a category source to either an existing backend ID or a create mapping
 */
function getBatchCategoryMapping(
  source: string,
  mappingsBySource: Map<string, TransactionImportCategoryMapping>,
  sourceIds: Record<string, string>,
): TransactionImportCategoryMapping {
  const categoryId = sourceIds[source];
  if (categoryId) return { source, category_id: categoryId };

  const mapping = mappingsBySource.get(source);
  if (!mapping) throw new Error(`Category source is not mapped: ${source}`);
  return mapping;
}

function getImportMappingsBySource<T extends { source: string }>(mappings: T[]) {
  return new Map(mappings.map((mapping) => [mapping.source, mapping]));
}

/**
 * Estimates the payload bytes added by a not-yet-included account source
 */
function getNextAccountMappingByteSize(
  source: string,
  sources: Set<string>,
  mappingsBySource: Map<string, TransactionImportAccountMapping>,
  sourceIds: Record<string, string>,
) {
  if (sources.has(source)) return 0;
  return getNextArrayItemByteSize(
    sources.size,
    getBatchAccountMapping(source, mappingsBySource, sourceIds),
  );
}

/**
 * Estimates the payload bytes added by a not-yet-included category source
 */
function getNextCategoryMappingByteSize(
  source: string,
  sources: Set<string>,
  mappingsBySource: Map<string, TransactionImportCategoryMapping>,
  sourceIds: Record<string, string>,
) {
  if (sources.has(source)) return 0;
  return getNextArrayItemByteSize(
    sources.size,
    getBatchCategoryMapping(source, mappingsBySource, sourceIds),
  );
}

function getNextArrayItemByteSize(currentLength: number, value: unknown) {
  return getJsonByteSize(value) + (currentLength > 0 ? 1 : 0);
}

function getEmptyImportPayloadByteSize() {
  return getJsonByteSize({ accounts: [], categories: [], rows: [] });
}

/**
 * Yields during large imports so the browser can paint between batch-building chunks
 */
function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

function getJsonByteSize(value: unknown) {
  return IMPORT_PAYLOAD_ENCODER.encode(JSON.stringify(value)).length;
}

/**
 * Builds the aggregate response shape before batch results are merged into it
 */
function getEmptyImportResponse(): FireflyTransactionImportResponse {
  return {
    rows_imported: 0,
    rows_skipped: 0,
    skipped: [],
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
  };
}

/**
 * Merges batch responses into the aggregate import result shown to the user
 */
function mergeImportResponse(
  target: FireflyTransactionImportResponse,
  source: FireflyTransactionImportResponse,
) {
  target.rows_imported += source.rows_imported;
  target.rows_skipped += source.rows_skipped;
  target.skipped.push(...source.skipped);
  target.transactions_created += source.transactions_created;
  target.accounts_created += source.accounts_created;
  target.accounts_reused += source.accounts_reused;
  target.categories_created += source.categories_created;
  target.categories_reused += source.categories_reused;
  target.merchants_created += source.merchants_created;
  target.merchants_reused += source.merchants_reused;
  target.tags_created += source.tags_created;
  target.tags_reused += source.tags_reused;
  Object.assign(target.account_source_ids, source.account_source_ids);
  Object.assign(target.category_source_ids, source.category_source_ids);
  appendUnique(target.affected_account_ids, source.affected_account_ids);
  appendUnique(target.created_account_ids, source.created_account_ids);
  appendUnique(target.created_category_ids, source.created_category_ids);
  appendUnique(target.created_merchant_ids, source.created_merchant_ids);
  appendUnique(target.created_tag_ids, source.created_tag_ids);
}

/**
 * Appends IDs while keeping aggregate import response lists stable across batches
 */
function appendUnique(target: string[], source: string[]) {
  for (const value of source) {
    if (!target.includes(value)) target.push(value);
  }
}
