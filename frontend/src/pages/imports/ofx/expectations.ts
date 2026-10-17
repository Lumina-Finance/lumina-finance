import type { ImportExpectations } from '@/pages/imports/types'

// What the save does with a transaction whose bank ID the account already holds, which a deleted
// transaction no longer does
const ALREADY_IMPORTED_CHANGE = "Skipped, so a statement that overlaps an earlier one adds only what's new. One you deleted comes back"
const ALREADY_IMPORTED_SOURCE = 'A transaction an earlier OFX import brought into the account'

/**
 * What an OFX import does with a statement and what it leaves out, shown before anything is staged
 *
 * Every claim is one the import enforces: a statement goes into the account chosen for it and is
 * refused when that account is kept in another currency, money out files under the seeded
 * Miscellaneous category and money in under Other Income, the bank's stated balance is not read,
 * investment and loan statements are counted and left out, and a transaction whose date or amount
 * cannot be read, whose amount is in another currency than the statement, whose amount has more decimal places than the currency, whose payee name or
 * memo is over the limit, whose bank transaction ID is over the length the app keeps, or whose bank
 * transaction ID an earlier transaction of the same file or an earlier file of the same import
 * already has is listed and skipped. The save then skips a transaction whose bank transaction ID
 * its account already holds from an earlier import, and a deleted one holds none
 */
export const OFX_EXPECTATIONS: ImportExpectations = {
  intro: 'Each transaction in your statements becomes one transaction in the account you match them to, so one file can fill several accounts and several files can fill one.',
  deviation: "The balance your bank states isn't imported. A new account starts at zero, so it only counts the transactions you import.",
  changes: [
    {
      source: 'A payee',
      lumina: 'A merchant',
    },
    {
      source: 'A memo',
      lumina: 'The transaction\'s note',
    },
    {
      source: 'A transaction',
      lumina: 'Filed under Miscellaneous when money goes out and Other Income when it comes in, since statements carry no categories',
    },
    {
      source: ALREADY_IMPORTED_SOURCE,
      lumina: ALREADY_IMPORTED_CHANGE,
    },
    {
      source: 'A statement in another currency than its account',
      lumina: "Refused, since a transaction takes its account's currency. Choose an account in the statement's currency",
    },
    {
      source: 'A new account',
      lumina: 'No opening balance or credit limit until you add them',
    },
  ],
  leftBehind: [
    {
      group: 'Statements',
      items: [
        'Investment',
        'Loan',
      ],
    },
    {
      group: 'Transactions',
      items: [
        'With no readable date or amount',
        'With an amount in another currency than their statement',
        'With more decimal places than their currency allows',
        'With a payee name or memo over the limits this app takes',
        'Already in an earlier file of the same import, by the bank\'s transaction ID',
        'Listed twice in the same file',
        'With a bank ID over the length this app takes',
      ],
    },
    {
      group: 'Not imported',
      items: [
        'Check numbers and transaction types',
      ],
    },
  ],
}

/**
 * What an OFX import started from an account's page does, which differs from the general import in
 * where the statement goes: its one statement is written to that account, a file of several is
 * refused, and no account is created
 *
 * @param accountName - The account every transaction is written to
 */
export function getOfxFixedAccountExpectations(accountName: string): ImportExpectations {
  return {
    ...OFX_EXPECTATIONS,
    intro: `Each transaction in your statement becomes one transaction in ${accountName}.`,
    deviation: `The balance your bank states isn't imported, so the balance of ${accountName} only changes by the transactions you import.`,
    changes: [
      ...OFX_EXPECTATIONS.changes
        .filter((change) => change.source !== 'A new account' && !change.source.startsWith('A statement in another currency'))
        .map((change) => change.source === ALREADY_IMPORTED_SOURCE
          ? { ...change, source: `A transaction an earlier OFX import brought into ${accountName}` }
          : change),
      {
        source: `A statement in another currency than ${accountName}`,
        lumina: "Refused, since a transaction takes its account's currency",
      },
      {
        source: 'A file with several statements',
        lumina: 'Refused here, since the page takes one statement from each file. Import it from the Imports page in Settings',
      },
    ],
  }
}
