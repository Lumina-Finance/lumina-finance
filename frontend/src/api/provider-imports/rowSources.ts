import type { JournalImportRow } from '@/api/provider-imports/types';

/**
 * Category mapping source the backend expects for rows without a category
 */
export const JOURNAL_NO_CATEGORY_SOURCE = '(no category)';

/**
 * Lists the account mapping sources one journal row references
 */
export function getJournalRowAccountSources(row: JournalImportRow) {
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
 * Decided as the backend decides it: a withdrawal from an imported account or a deposit into one,
 * with the other endpoint outside the import, reads its category, and so does a transfer naming
 * the leg that carries it. Any other transfer takes Transfer and a balance row Balance Adjustment,
 * so a batch of those maps no category
 */
export function getJournalRowCategorySource(row: JournalImportRow): string | null {
  const journalType = row.type.trim().toLowerCase();
  if (journalType === 'transfer' && row.category_leg) return row.category?.trim() || null;
  const isWithdrawalOut = journalType === 'withdrawal' && Boolean(row.source_account) && !row.destination_account;
  const isDepositIn = journalType === 'deposit' && Boolean(row.destination_account) && !row.source_account;
  if (!isWithdrawalOut && !isDepositIn) return null;
  return row.category?.trim() || JOURNAL_NO_CATEGORY_SOURCE;
}
