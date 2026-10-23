import { authenticatedFetch } from '@/api/client';
import type {
  HeldBankTransactionItem,
  HeldBankTransactionsResponse,
  SavedAccountImportSource,
  SavedCsvImportLayout,
} from '@/api/transaction-imports/types';

/**
 * Reads how CSV files were read for each of the user's own accounts, the most recently saved first
 */
export function fetchImportLayouts(signal?: AbortSignal) {
  return authenticatedFetch<SavedCsvImportLayout[]>('/transactions/import/layouts', { signal });
}

/**
 * Reads which importer last brought transactions into each of the user's own accounts
 */
export function fetchImportSources(signal?: AbortSignal) {
  return authenticatedFetch<SavedAccountImportSource[]>('/transactions/import/sources', { signal });
}

/**
 * Asks which OFX transactions their account already holds, by position in the list sent
 *
 * The bank values travel in the body only, so no cache key, log or URL carries them
 */
export function fetchHeldBankTransactions(items: HeldBankTransactionItem[], signal?: AbortSignal) {
  return authenticatedFetch<HeldBankTransactionsResponse>('/transactions/import/held-bank-transactions', {
    method: 'POST',
    body: JSON.stringify({ items }),
    signal,
  });
}
