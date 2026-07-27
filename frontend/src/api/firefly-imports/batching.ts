import { postFireflyTransactionImportBatch } from '@/api/firefly-imports/requests';
import {
  getFireflyRowAccountSources,
  getFireflyRowCategorySource,
} from '@/api/firefly-imports/rowSources';
import type {
  FireflyTransactionImportPayload,
  FireflyTransactionImportResponse,
  FireflyTransactionImportRow,
} from '@/api/firefly-imports/types';
import {
  getEmptyBaseImportResponse,
  importInBatches,
  mergeBaseImportResponse,
} from '@/api/shared/importBatching';

/**
 * Uploads Firefly III imports in bounded batches that preserve backend-created source mappings
 */
export function importFireflyTransactionsInBatches(payload: FireflyTransactionImportPayload) {
  return importInBatches<FireflyTransactionImportRow, FireflyTransactionImportResponse>(payload, {
    getRowAccountSources: getFireflyRowAccountSources,
    getRowCategorySource: getFireflyRowCategorySource,
    postBatch: postFireflyTransactionImportBatch,
    createEmptyResponse: () => ({
      ...getEmptyBaseImportResponse(),
      rows_imported: 0,
      rows_skipped: 0,
      skipped: [],
    }),
    mergeResponse: (target, source) => {
      mergeBaseImportResponse(target, source);
      target.rows_imported += source.rows_imported;
      target.rows_skipped += source.rows_skipped;
      target.skipped.push(...source.skipped);
    },
  });
}
