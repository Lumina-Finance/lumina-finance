import type { ImportExpectations } from '@/pages/imports/types'

/**
 * What a QIF import does with a file and what it leaves out, shown before anything is staged
 *
 * Every claim is one the import enforces: each account section goes into the account chosen for it
 * in the currency of that account, since the file states none, categories, classes, tags and
 * transfers are not read so money out files under Miscellaneous and money in under Other Income, a
 * split transaction comes in as one transaction for its total once its parts add up, investment
 * sections are counted and left out, and a transaction whose year has two digits after a slash, whose
 * two amount lines disagree, or whose splits do not add up is listed and skipped before the commit.
 * A QIF file carries no transaction ID, so an import cannot tell a transaction it already brought in
 */
export const QIF_EXPECTATIONS: ImportExpectations = {
  intro:
    'Each transaction in your QIF files becomes one transaction in the account you match its section to, so one file can fill several accounts and several files can fill one.',
  deviation:
    "Re-importing a file adds its transactions again, since a QIF file has no transaction IDs to tell them apart. If that happens, undo the import. The balance your app states isn't imported either, so a new account starts at zero.",
  changes: [
    {
      source: 'A payee',
      lumina: 'A merchant',
    },
    {
      source: 'A memo',
      lumina: "The transaction's note",
    },
    {
      source: 'A transaction',
      lumina:
        'Filed under Miscellaneous when money goes out and Other Income when it comes in, since categories, classes, tags and transfers are not read. A transfer between two accounts comes in as spending or income until you change it',
    },
    {
      source: 'A split transaction',
      lumina: 'One transaction for its total. The split details are not kept',
    },
    {
      source: 'A date or amount that can be written more than one way',
      lumina: 'Read the way you choose under the staged files, and never guessed. The import waits until you choose',
    },
    {
      source: 'An account',
      lumina:
        "Created in the currency you choose, since a QIF file doesn't state one. It starts at zero, and an Opening Balance transaction in the file comes in like any other, so don't add an opening balance for the same amount",
    },
  ],
  leftBehind: [
    {
      group: 'Sections',
      items: ['Investment'],
    },
    {
      group: 'Transactions',
      items: [
        'With no readable date or amount',
        'With a two-digit year after a slash, since the century would be a guess',
        'With two amount lines that disagree',
        'With splits that do not add up to the total',
        'With more decimal places than their currency allows',
        'With a merchant name or memo over the limits this app takes',
      ],
    },
    {
      group: 'Not imported',
      items: ['Categories, classes, tags and transfer links', 'Split details', 'Check numbers and cleared marks'],
    },
  ],
}

/**
 * What a QIF import started from an account's page does, which differs from the general import in
 * where the file goes: its one account is written to that account, a file of several is refused, and
 * no account is created
 *
 * @param accountName - The account every transaction is written to
 */
export function getQifFixedAccountExpectations(accountName: string): ImportExpectations {
  return {
    ...QIF_EXPECTATIONS,
    intro: `Each transaction in your QIF file becomes one transaction in ${accountName}.`,
    deviation: `Re-importing a file adds its transactions again, since a QIF file has no transaction IDs to tell them apart. If that happens, undo the import. The balance of ${accountName} only changes by the transactions you import.`,
    changes: [
      ...QIF_EXPECTATIONS.changes.filter((change) => change.source !== 'An account'),
      {
        source: 'A file with several accounts',
        lumina:
          'Refused here, since the page takes one account from each file. Import it from the Imports page in Settings',
      },
    ],
  }
}
