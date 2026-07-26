import type { FireflyTransactionImportRow } from '@/api/firefly-imports/types';

/**
 * Firefly III account types that resolve to Lumina accounts rather than
 * merchants, matched case-insensitively against source and destination types
 */
const FIREFLY_TRACKED_ACCOUNT_TYPES = new Set(['asset account', 'loan', 'debt', 'mortgage']);

/**
 * Category mapping source the backend expects for rows without a category
 */
export const FIREFLY_NO_CATEGORY_SOURCE = '(no category)';

/**
 * Checks whether a Firefly III endpoint type must be mapped to a Lumina account
 */
export function isFireflyTrackedAccountType(accountType: string | null | undefined) {
  if (!accountType) return false;
  return FIREFLY_TRACKED_ACCOUNT_TYPES.has(accountType.trim().toLowerCase());
}

/**
 * Lists the account mapping sources one journal row references
 */
export function getFireflyRowAccountSources(row: FireflyTransactionImportRow) {
  const sources: string[] = [];
  if (row.source_name && isFireflyTrackedAccountType(row.source_type)) sources.push(row.source_name);
  if (
    row.destination_name
    && isFireflyTrackedAccountType(row.destination_type)
    && row.destination_name !== sources[0]
  ) {
    sources.push(row.destination_name);
  }
  return sources;
}

/**
 * Gets the category mapping source one journal row references
 */
export function getFireflyRowCategorySource(row: FireflyTransactionImportRow) {
  return row.category?.trim() || FIREFLY_NO_CATEGORY_SOURCE;
}
