import { authenticatedFetch } from '@/api/client';
import type {
  FireflyTransactionImportPayload,
  FireflyTransactionImportResponse,
} from '@/api/dataImports/types';

/**
 * Uploads one prepared Firefly III transaction import batch to the backend
 */
export function postFireflyTransactionImportBatch(payload: FireflyTransactionImportPayload) {
  return authenticatedFetch<FireflyTransactionImportResponse>('/data-imports/firefly/transactions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
