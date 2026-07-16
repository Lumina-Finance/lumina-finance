import { authenticatedFetch } from '@/api/client';
import type {
  FireflyBudgetImportPayload,
  FireflyBudgetImportResponse,
  FireflyTransactionImportPayload,
  FireflyTransactionImportResponse,
} from '@/api/fireflyImports/types';

/**
 * Uploads one prepared Firefly III transaction import batch to the backend
 */
export function postFireflyTransactionImportBatch(payload: FireflyTransactionImportPayload) {
  return authenticatedFetch<FireflyTransactionImportResponse>('/transactions/import/firefly', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Creates all selected Firefly III budgets with their limit histories in one
 * atomic backend request
 */
export function postFireflyBudgetImport(payload: FireflyBudgetImportPayload) {
  return authenticatedFetch<FireflyBudgetImportResponse>('/transactions/import/firefly/budgets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
