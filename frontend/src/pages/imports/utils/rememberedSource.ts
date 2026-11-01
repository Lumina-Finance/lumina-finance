import type { SavedAccountImportSource } from '@/api/transaction-imports'
import type { ImportDataSource } from '@/pages/imports/types'

/**
 * The sources an account's own import page offers, in the order it lists them. Firefly III and Actual
 * Budget exports cover many accounts, so they stay on the general Imports page
 */
export const ACCOUNT_DATA_SOURCES: readonly ImportDataSource[] = ['generic', 'ofx', 'qif']

/** What the page opens on when nothing applies: no earlier import, or one from a source it doesn't offer */
export const DEFAULT_DATA_SOURCE: ImportDataSource = 'generic'

/**
 * Picks the source an account's import page opens on from the sources saved for the user's accounts
 *
 * @param saved - The saved sources, undefined while they are unavailable
 * @param accountId - The account the page was opened for
 */
export function getRememberedDataSource(
  saved: SavedAccountImportSource[] | undefined,
  accountId: string,
): ImportDataSource {
  const source = saved?.find((entry) => entry.account_id === accountId)?.source
  return source === 'ofx' || source === 'qif' ? source : DEFAULT_DATA_SOURCE
}
