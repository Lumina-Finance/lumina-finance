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
    // A batch carries the mappings for every source its rows name, and the other side of a transfer
    // is one of them even though no row in the batch is written to it
    getRowAccountSources: (row) => (row.other_account_source
      ? [row.account_source, row.other_account_source]
      : [row.account_source]),
    getRowCategorySource: (row) => row.category_source,
    postBatch: postTransactionImportBatch,
    createEmptyResponse: getEmptyBaseImportResponse,
    mergeResponse: mergeBaseImportResponse,
  });
}
