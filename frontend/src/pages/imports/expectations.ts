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
    intro: `Lumina Finance records each row of your file as one transaction in ${destination}, and reads only the `
      + 'columns you map.',
    deviation: 'A transfer row records only its own side. The other account changes only when your file has a row '
      + "of its own for that side, so until then its balance can read differently from your bank's.",
    changes: [
      {
        source: 'A currency column',
        lumina: "A check against the account's currency, with nothing converted. A row in another currency is left "
          + 'out and listed, unless you write it to an account in that currency or stop importing the column',
      },
      {
        source: 'An account the import creates',
        lumina: 'A new account with no opening balance and no credit limit, which you can add once it exists',
      },
    ],
    leftBehind: [
      {
        group: "Anything that isn't a transaction row",
        items: [
          'Budgets',
          "A running balance or any other column you don't map",
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
