import { ACTUAL_EXPECTATIONS } from '@/pages/imports/actual/expectations'
import { FIREFLY_EXPECTATIONS } from '@/pages/imports/firefly/expectations'
import type { ImportDataSource, ImportExpectations } from '@/pages/imports/types'

/**
 * What a CSV import does with a file and what it leaves out, shown before anything is staged
 *
 * Every claim is one the import enforces: each row is written as one transaction in its own
 * account and nothing is written to a transfer's other account, a currency column only leaves out a
 * row whose account is kept in another currency, new accounts start at a zero balance with no
 * credit limit, and the payload carries transaction rows and their mappings only
 *
 * @param fixedAccountName - The account an import started from an account's page writes every row
 *   to, null for an ordinary import
 */
export function getCsvExpectations(fixedAccountName: string | null): ImportExpectations {
  const destination = fixedAccountName ?? 'the account you map it to'

  return {
    intro: `Each row of your file becomes one transaction in ${destination}.`,
    deviation: "A transfer row only changes its own account. Import the other account's side too, or that account's "
      + "balance won't match your bank's.",
    changes: [
      {
        source: 'A currency column',
        lumina: "Checked, not converted. A row in a currency its account isn't kept in is left out",
      },
      {
        source: 'A new account',
        lumina: 'No opening balance or credit limit until you add them',
      },
    ],
    leftBehind: [
      {
        group: 'Not imported',
        items: [
          'Budgets',
          "Columns you don't map, like a running balance",
        ],
      },
    ],
  }
}

/**
 * Picks the card that says what an import does with its data, for the import being shown
 *
 * @param fixedAccountName - The account a CSV import started from an account's page writes to
 */
export function getImportExpectations(source: ImportDataSource, fixedAccountName: string | null): ImportExpectations {
  if (source === 'firefly') return FIREFLY_EXPECTATIONS
  if (source === 'actual') return ACTUAL_EXPECTATIONS
  return getCsvExpectations(fixedAccountName)
}
