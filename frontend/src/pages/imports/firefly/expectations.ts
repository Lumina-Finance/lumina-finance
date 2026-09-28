import type { ImportExpectations } from '@/pages/imports/types'

const CONVERTED_MAPPINGS: ImportExpectations['changes'] = [
  {
    source: 'One transfer',
    lumina: 'Two entries, one per account, so your transaction count ends up higher than your row count',
  },
  {
    source: 'Expense and revenue accounts, like shops and employers',
    lumina: 'Merchants',
  },
  {
    source: 'A loan payment recorded as a withdrawal',
    lumina: 'A transfer between your account and the loan',
  },
  {
    source: 'A category on a transfer or loan payment between two imported accounts',
    lumina: 'The Transfer category, so the one you chose is dropped',
  },
  {
    source: 'A tag with a comma in its name',
    lumina: 'Separate tags split at each comma, since the export does not mark where a tag ends',
  },
  {
    source: 'A transaction paid in another currency',
    lumina: "Its amount in the account's currency only, since every transaction here is in its account's currency",
  },
  {
    source: 'A split transaction group',
    lumina: 'Separate entries that are no longer linked',
  },
  {
    source: 'Journal description, always required',
    lumina: 'Notes, which are optional here',
  },
  {
    source: 'Budget limit periods, whatever their length',
    lumina: 'One budget period each, with the original dates and amounts, continuing on the cadence of the latest period, or not recurring when no cadence fits',
  },
  {
    source: 'A budget you archived',
    lumina: 'An archived budget here too, keeping every limit period it ever ran',
  },
  {
    source: 'An account you made inactive that the import creates, when you add the accounts file',
    lumina: 'An archived account, with any money left in it brought to zero on the day you import',
  },
]

/**
 * The one difference whose figures will not tie back to Firefly III, which is
 * worth finding before the numbers are compared rather than after
 */
const DEVIATION_TEXT = "Firefly III sets a budget on each transaction. This app's budgets track whole "
  + 'categories, so anything you left out of a budget there still counts against it here, and the amount '
  + 'left can read lower than Firefly III shows.'

/**
 * Everything the import leaves behind, grouped by what it applies to and
 * listed without saying which might arrive later, since nothing here is
 * committed to and a hint otherwise would be read as a promise
 *
 * The budget and transaction entries only catch the rare shapes they name,
 * which are skipped and reported, except future-dated transactions, which the
 * export never holds. The feature entries never arrive
 */
const LEFT_BEHIND: ImportExpectations['leftBehind'] = [
  {
    group: 'Budgets that are',
    items: [
      'Repeating on period lengths Lumina Finance has no cadence for',
      'Mixing more than one currency across their limit periods',
      'In a currency Lumina Finance does not support',
      'Set with limit periods that overlap',
    ],
  },
  {
    group: 'Transactions',
    items: [
      'With more decimal places than their currency allows',
      'With a tag too long for this app',
      "Of the Liability credit type, which repeats a liability's opening balance",
      'Dated after the day you export, which the export leaves out',
    ],
  },
  {
    group: 'Features',
    items: [
      'Bills and recurring transactions',
      'Piggy banks and reconciliation flags',
      'Account interest and card details',
      'Rules and attachments',
    ],
  },
]

/** What a Firefly III import changes, keeps and leaves behind, shown before anything is staged */
export const FIREFLY_EXPECTATIONS: ImportExpectations = {
  intro: 'Firefly III records every journal against two accounts. Lumina Finance records one entry per account, so '
    + 'some of your data changes shape on the way in.',
  deviation: DEVIATION_TEXT,
  changes: CONVERTED_MAPPINGS,
  leftBehind: LEFT_BEHIND,
}
