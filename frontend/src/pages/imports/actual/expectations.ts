import type { ImportExpectations } from '@/pages/imports/types'

/**
 * What an Actual Budget import changes, keeps and leaves behind, shown before anything is staged
 *
 * The transaction entries in the left-behind group are skipped and listed before the import, and
 * the feature entries never arrive
 */
export const ACTUAL_EXPECTATIONS: ImportExpectations = {
  intro: 'Actual Budget gives money to categories month by month and keeps some accounts off the budget. Lumina '
    + 'Finance records one entry per account and tracks spending against budgets by category, so some of your data '
    + 'is imported in a different form.',
  deviation: 'Only the amount you budgeted each month is imported. Money Actual rolled over from one month to the '
    + 'next and what it showed as To Budget are not imported, so what a budget has left can read differently from '
    + 'the balance Actual shows.',
  changes: [
    {
      source: 'One transfer',
      lumina: 'Two entries, one per account, so your transaction count ends up higher than your row count',
    },
    {
      source: 'A payment with a category to an off-budget account, like a loan payment',
      lumina: 'By default, a transfer between the two accounts, which budgets don\'t count, or one to or from outside the app when its other side isn\'t in the file. You can import it as an expense in its category instead, so its budget counts it as Actual did, and the off-budget account still shows the payment arriving',
    },
    {
      source: 'A transfer with no category that pays a credit card, line of credit or HELOC',
      lumina: 'A payment in Credit Card Payment on both accounts, which doesn\'t count as spending',
    },
    {
      source: 'A split transaction',
      lumina: 'Separate entries that are no longer linked, each keeping the payee and notes',
    },
    {
      source: 'Payees',
      lumina: 'Merchants',
    },
    {
      source: 'A #hashtag in the notes',
      lumina: 'A tag, with the notes kept as written',
    },
    {
      source: 'A transfer to an account you have since deleted',
      lumina: 'A payment with no payee, as Actual now shows it',
    },
    {
      source: 'Off-budget accounts',
      lumina: 'Ordinary accounts, since every account here counts toward your balances',
    },
    {
      source: 'Each month you budgeted a category',
      lumina: 'One budget period for that month, repeating monthly only when you budgeted for this month or later',
    },
    {
      source: 'A hidden category or category group',
      lumina: 'An archived budget',
    },
    {
      source: 'A closed account the import creates',
      lumina: 'An archived account, with any money left in it brought to zero on the day you import, or an open one while it holds transactions dated after today',
    },
    {
      source: 'A transaction dated after today',
      lumina: 'The same transaction, which counts toward balances and budgets from its date',
    },
  ],
  leftBehind: [
    {
      group: 'Budgets',
      items: [
        'For income, which a tracking budget can hold',
        'For months budgeted at zero or below',
        'Templates and goals',
      ],
    },
    {
      group: 'Transactions',
      items: [
        'Split into parts that no longer add up to the total',
        'With more decimal places than their currency allows',
        'With notes, tags or a payee over the limits this app takes',
      ],
    },
    {
      group: 'Features',
      items: [
        'Schedules and rules',
        'Reconciliation and cleared flags',
        'Bank sync links',
        'Reports and dashboards',
      ],
    },
  ],
}
