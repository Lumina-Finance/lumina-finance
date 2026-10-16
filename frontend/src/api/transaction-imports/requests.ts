import { authenticatedFetch } from '@/api/client';
import type { SavedAccountImportSource, SavedCsvImportLayout } from '@/api/transaction-imports/types';

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
