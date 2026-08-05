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
import type {
  TransactionImportAccountMapping,
  TransactionImportCategoryMapping,
  TransactionImportResponse,
} from '@/api/transaction-imports/types';

/**
 * Request payload shape a domain must produce for the batching engine to split across requests
 */
export interface ImportBatchPayload<TRow> {
  accounts: TransactionImportAccountMapping[];
  categories: TransactionImportCategoryMapping[];
  rows: TRow[];
}

/**
 * Domain-specific behaviour the batching engine needs from a caller
 *
 * `getRowAccountSources` returns every account mapping source one row touches. A row can
 * reference zero, one, or more accounts depending on the domain, so the engine treats the
 * result as a list rather than assuming a single account per row
 */
export interface ImportBatchEngine<TRow, TResponse extends TransactionImportResponse> {
  getRowAccountSources: (row: TRow) => string[];
  getRowCategorySource: (row: TRow) => string;
  postBatch: (batchPayload: ImportBatchPayload<TRow>) => Promise<TResponse>;
  createEmptyResponse: () => TResponse;
  mergeResponse: (target: TResponse, source: TResponse) => void;
}

/**
 * Uploads an import payload in bounded batches that preserve backend-created source mappings
 */
export async function importInBatches<TRow, TResponse extends TransactionImportResponse>(
  payload: ImportBatchPayload<TRow>,
  engine: ImportBatchEngine<TRow, TResponse>,
): Promise<TResponse> {
  const accountMappingsBySource = getImportMappingsBySource(payload.accounts);
  const categoryMappingsBySource = getImportMappingsBySource(payload.categories);
  const accountSourceIds: Record<string, string> = {};
  const categorySourceIds: Record<string, string> = {};
  const result = engine.createEmptyResponse();
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
      engine,
    );
    rowIndex = batch.nextRowIndex;
    const batchResult = await engine.postBatch(batch.payload);
    engine.mergeResponse(result, batchResult);
    Object.assign(accountSourceIds, batchResult.account_source_ids);
    Object.assign(categorySourceIds, batchResult.category_source_ids);
  }

  return result;
}

/**
 * Builds the next import batch without exceeding the request-size budget
 */
async function buildNextImportBatch<TRow, TResponse extends TransactionImportResponse>(
  payload: ImportBatchPayload<TRow>,
  startIndex: number,
  accountMappingsBySource: Map<string, TransactionImportAccountMapping>,
  categoryMappingsBySource: Map<string, TransactionImportCategoryMapping>,
  accountSourceIds: Record<string, string>,
  categorySourceIds: Record<string, string>,
  engine: ImportBatchEngine<TRow, TResponse>,
) {
  const sourceRows = payload.rows;
  const rows: TRow[] = [];
  const accountSources = new Set<string>();
  const categorySources = new Set<string>();
  let estimatedBytes = getEmptyImportPayloadByteSize();
  let rowIndex = startIndex;

  // Each row may introduce account and category mappings, so the batch budget tracks both
  while (rowIndex < sourceRows.length) {
    const row = sourceRows[rowIndex];
    const rowAccountSources = engine.getRowAccountSources(row);
    const rowCategorySource = engine.getRowCategorySource(row);
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

    // Mappings are small enough that a file with many distinct values fills the count long before
    // it fills the byte budget, so both are what closes a batch
    const nextAccountSources = countWithNewSources(accountSources, rowAccountSources);
    const nextCategorySources = countWithNewSources(categorySources, [rowCategorySource]);
    const isBatchFull = nextEstimatedBytes > TARGET_IMPORT_BATCH_BYTES
      || rows.length >= MAX_IMPORT_BATCH_ROWS
      || nextAccountSources > MAX_IMPORT_BATCH_MAPPINGS
      || nextCategorySources > MAX_IMPORT_BATCH_MAPPINGS;

    if (rows.length > 0 && isBatchFull) break;
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

  // The endpoint requires at least one account mapping per request. A row can carry zero
  // account sources (for example a Firefly row with no tracked source or destination
  // account), so a batch built entirely from such rows borrows one known mapping
  if (accountSources.size === 0 && payload.accounts.length > 0) {
    accountSources.add(getBorrowedAccountSource(payload.accounts, accountSourceIds));
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
function buildImportBatchPayload<TRow>(
  rows: TRow[],
  accountSources: string[],
  categorySources: string[],
  accountMappingsBySource: Map<string, TransactionImportAccountMapping>,
  categoryMappingsBySource: Map<string, TransactionImportCategoryMapping>,
  accountSourceIds: Record<string, string>,
  categorySourceIds: Record<string, string>,
): ImportBatchPayload<TRow> {
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
 * Counts what a set would hold once the given sources were added to it
 */
function countWithNewSources(sources: Set<string>, candidates: string[]) {
  const added = new Set(candidates.filter((source) => !sources.has(source)));
  return sources.size + added.size;
}

/**
 * Picks the mapping a batch with no account sources of its own carries
 *
 * A source an earlier batch already created, or one that states an account that exists, costs
 * nothing to carry. A create mapping would have the backend create an account no row in the batch
 * references, so it is the last resort rather than the first choice
 */
function getBorrowedAccountSource(
  accounts: TransactionImportAccountMapping[],
  accountSourceIds: Record<string, string>,
) {
  const alreadyCreated = accounts.find((mapping) => accountSourceIds[mapping.source]);
  if (alreadyCreated) return alreadyCreated.source;

  const existingAccount = accounts.find((mapping) => mapping.account_id);
  if (existingAccount) return existingAccount.source;

  return accounts[0].source;
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

/**
 * Builds the response fields shared by every import domain, before batch results are merged
 * in or a domain adds its own fields on top
 */
export function getEmptyBaseImportResponse(): TransactionImportResponse {
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
  };
}

/**
 * Merges the response fields shared by every import domain into the aggregate import result
 * shown to the user. A domain with its own extra response fields merges those separately
 */
export function mergeBaseImportResponse(
  target: TransactionImportResponse,
  source: TransactionImportResponse,
) {
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
 *
 * Membership is tested against a set rather than the list itself, since an import creating tens of
 * thousands of merchants would otherwise scan the whole list once per id
 */
function appendUnique(target: string[], source: string[]) {
  const seen = new Set(target);

  for (const value of source) {
    if (seen.has(value)) continue;
    seen.add(value);
    target.push(value);
  }
}
