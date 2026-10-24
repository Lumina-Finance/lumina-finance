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

// Transactions asked about in one request, within the most the API takes and far enough under the
// request body limit that long bank IDs still fit
export const HELD_CHECK_REQUEST_ITEMS = 2_000;

/**
 * Asks which OFX transactions their account already holds, by position in the list sent
 *
 * A long list is asked in parts, one after the other, and the positions are given for the whole list.
 * The bank values travel in the bodies only, so no cache key, log or URL carries them
 */
export async function fetchHeldBankTransactions(items: HeldBankTransactionItem[], signal?: AbortSignal) {
  const held: number[] = [];
  for (let start = 0; start < items.length; start += HELD_CHECK_REQUEST_ITEMS) {
    const part = await authenticatedFetch<HeldBankTransactionsResponse>('/transactions/import/held-bank-transactions', {
      method: 'POST',
      body: JSON.stringify({ items: items.slice(start, start + HELD_CHECK_REQUEST_ITEMS) }),
      signal,
    });
    held.push(...part.held.map((position) => start + position));
  }
  return { held };
}
