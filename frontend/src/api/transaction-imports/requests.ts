import { authenticatedFetch } from '@/api/client';
import type {
  TransactionImportPayload,
  TransactionImportResponse,
} from '@/api/transaction-imports/types';

/**
 * Uploads one prepared transaction import batch to the backend
 */
export function postTransactionImportBatch(payload: TransactionImportPayload) {
  return authenticatedFetch<TransactionImportResponse>('/transactions/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
