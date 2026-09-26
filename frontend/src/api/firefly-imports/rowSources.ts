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
  if (row.source_account) sources.push(row.source_account);
  if (row.destination_account && row.destination_account !== row.source_account) {
    sources.push(row.destination_account);
  }
  return sources;
}

/**
 * Gets the category mapping source one journal row is written with, or null when it takes none
 *
 * Decided as the backend decides it: only a withdrawal from an imported account or a deposit into
 * one, with the other endpoint outside the import, reads its category. A transfer takes Transfer
 * and a balance row Balance Adjustment, so a batch of those maps no category
 */
export function getFireflyRowCategorySource(row: FireflyTransactionImportRow): string | null {
  const journalType = row.type.trim().toLowerCase();
  const isWithdrawalOut = journalType === 'withdrawal' && Boolean(row.source_account) && !row.destination_account;
  const isDepositIn = journalType === 'deposit' && Boolean(row.destination_account) && !row.source_account;
  if (!isWithdrawalOut && !isDepositIn) return null;
  return row.category?.trim() || FIREFLY_NO_CATEGORY_SOURCE;
}
