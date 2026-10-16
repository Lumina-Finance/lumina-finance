import { authenticatedFetch } from '@/api/client';
import type { SavedCsvImportLayout } from '@/api/transaction-imports/types';

/**
 * Reads how CSV files were read for each of the user's own accounts, the most recently saved first
 */
export function fetchImportLayouts(signal?: AbortSignal) {
  return authenticatedFetch<SavedCsvImportLayout[]>('/transactions/import/layouts', { signal });
}
