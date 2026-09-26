import { isFireflyTrackedAccountType } from '@/api/firefly-imports/rowSources'
import { FIREFLY_ACTIVE_VALUE, FIREFLY_INACTIVE_VALUE } from '@/pages/imports/firefly/constants'
import type { FireflyAccountDetails } from '@/pages/imports/firefly/types'
import type { CsvRow } from '@/pages/imports/types'

/**
 * Keys an account by its name and its type, read the way Firefly III matches them, so a transaction
 * endpoint and a row of the accounts export find each other
 */
export function getFireflyAccountKey(name: string, type: string) {
  return JSON.stringify([name.trim(), type.trim().toLowerCase()])
}

/**
 * Reads the asset accounts and liabilities in the accounts export, the only accounts the import
 * creates, keyed the way transaction endpoints are
 *
 * Firefly III keeps names unique within a type, so a key only repeats in a file edited by hand,
 * where the first row is kept
 */
export function readFireflyAccountDetails(rows: CsvRow[]): Map<string, FireflyAccountDetails> {
  const details = new Map<string, FireflyAccountDetails>()

  for (const row of rows) {
    const name = row.name?.trim() ?? ''
    const type = row.type?.trim() ?? ''
    if (!name || !isFireflyTrackedAccountType(type)) continue

    const key = getFireflyAccountKey(name, type)
    if (details.has(key)) continue

    details.set(key, {
      name,
      type,
      role: row.role?.trim() ?? '',
      currencyCode: row.currency_code?.trim().toUpperCase() ?? '',
      isActive: row.active?.trim() === FIREFLY_ACTIVE_VALUE,
    })
  }

  return details
}

/**
 * Finds an asset account or liability whose active cell holds neither value Firefly III writes,
 * since reading it as inactive would archive the account and bring its balance to zero
 *
 * @returns The account's name, or null when every one can be read
 */
export function findFireflyUnreadableActiveAccount(rows: CsvRow[]) {
  const unreadable = rows.find((row) => (
    isFireflyTrackedAccountType(row.type)
    && ![FIREFLY_ACTIVE_VALUE, FIREFLY_INACTIVE_VALUE].includes(row.active?.trim() ?? '')
  ))
  return unreadable ? unreadable.name?.trim() ?? '' : null
}
