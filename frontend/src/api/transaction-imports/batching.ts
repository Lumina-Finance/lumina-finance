import {
  getEmptyBaseImportResponse,
  importInBatches,
  mergeBaseImportResponse,
} from '@/api/shared/importBatching';
import { postTransactionImportBatch } from '@/api/transaction-imports/requests';
import type {
  TransactionImportPayload,
  TransactionImportResponse,
  TransactionImportRow,
} from '@/api/transaction-imports/types';

/**
 * Uploads transaction imports in bounded batches that preserve backend-created source mappings
 */
export function importTransactionsInBatches(payload: TransactionImportPayload) {
  return importInBatches<TransactionImportRow, TransactionImportResponse>(payload, {
    getRowAccountSources: (row) => [row.account_source],
    getRowCategorySource: (row) => row.category_source,
    postBatch: postTransactionImportBatch,
    createEmptyResponse: getEmptyBaseImportResponse,
    mergeResponse: mergeBaseImportResponse,
  });
}
