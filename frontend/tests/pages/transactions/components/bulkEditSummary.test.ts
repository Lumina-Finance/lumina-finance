/**
 * Tests what the bulk edit summary panel shows for a given choice: the rows it sends, the notes
 * beside them, and the warnings that hold Apply disabled
 */
import { describe, expect, it } from 'vitest'
import { getBulkEditBlockers, type BulkEditChoice, type SelectedTransactionFacts } from '@/pages/transactions/components/bulk-edit/selection'
import { describeBulkEdit, shareOpening, type BulkEditSummary, type BulkEditSummaryLabels } from '@/pages/transactions/components/bulk-edit/summary'
import { chequingHalf, chequingHalf2, eurExpense, groceries, oldImport, pair, savingsHalf, unanswered, untouched } from './bulkEditFixtures'

const ACCOUNT_NAMES: Record<string, string> = {
  chequing: 'Chequing',
  savings: 'Savings',
  cash: 'Cash',
  us_savings: 'US Savings',
}

/** Resolves an account id the way the modal's own accountName lookup does */
function accountLabelById(accountId: string): string {
  return ACCOUNT_NAMES[accountId] ?? 'Account'
}

const labels: BulkEditSummaryLabels = {
  accountLabelById,
  categoryLabel: '',
  merchantLabel: '',
  tagLabels: [],
}

/**
 * Computes blockers the way the modal does, then asks describeBulkEdit for the same choice, so each
 * test states only the rows, choice, and label overrides it needs
 */
function summarize(
  rows: SelectedTransactionFacts[],
  choice: BulkEditChoice,
  labelOverrides: Partial<BulkEditSummaryLabels> = {},
  chosenCategoryRecordsTransferTarget: boolean | undefined = undefined,
): BulkEditSummary {
  const blockers = getBulkEditBlockers(rows, choice, chosenCategoryRecordsTransferTarget)
  return describeBulkEdit(choice, rows, blockers, { ...labels, ...labelOverrides }, chosenCategoryRecordsTransferTarget)
}

describe('the opening clause of a warning sentence', () => {
  it('reads as the whole selection once the count fills it', () => {
    expect(shareOpening(5, 5)).toBe('All 5 selected')
  })

  it('states both numbers otherwise', () => {
    expect(shareOpening(1, 5)).toBe('1 out of 5 selected')
    expect(shareOpening(3, 5)).toBe('3 out of 5 selected')
  })

  it('drops the count entirely once only one row is selected', () => {
    expect(shareOpening(1, 1)).toBe('The selected')
  })
})

describe('the rows, notes and warnings a bulk edit choice produces', () => {
  it('shows nothing while nothing is chosen over a clean pair', () => {
    expect(summarize(pair, untouched())).toEqual({ rows: [], notes: [], warnings: [] })
  })

  it('warns about a merchant-less row even while nothing else is chosen', () => {
    const result = summarize([oldImport], untouched())

    expect(result.rows).toEqual([])
    expect(result.warnings).toEqual([{
      key: 'without-merchant',
      text: 'The selected transaction is missing merchant information.',
    }])
  })

  it('keeps the without-merchant key stable while its text moves from singular to plural', () => {
    const one = summarize([oldImport], untouched())
    expect(one.warnings).toEqual([{
      key: 'without-merchant',
      text: 'The selected transaction is missing merchant information.',
    }])

    const two = summarize([oldImport, { ...oldImport, id: 'old_import_2' }], untouched())
    expect(two.warnings).toEqual([{
      key: 'without-merchant',
      text: 'All 2 selected transactions are missing merchant information.',
    }])
  })

  it('shows the direction row and the other-half note over a transfer selection', () => {
    const choice = untouched({ direction: 'debit', endsAreOffered: true })
    const result = summarize(pair, choice)

    expect(result.rows).toEqual([{ label: 'Direction', value: 'Debit' }])
    expect(result.notes).toEqual([{
      key: 'other-half',
      text: 'Adjustments to a transfer affect the selected transaction only and do not update its counterpart.',
    }])
  })

  it('shows the direction row reversed with no note over a plain expense selection', () => {
    const expenses = [groceries, { ...groceries, id: 'expense_2' }, { ...groceries, id: 'expense_3' }]
    const choice = untouched({ direction: 'reverse', endsAreOffered: false })
    const result = summarize(expenses, choice)

    expect(result.rows).toEqual([{ label: 'Direction', value: 'Reversed' }])
    expect(result.notes).toEqual([])
  })

  it('shows the account a move sends every selected row to', () => {
    const rows = [groceries, { ...groceries, id: 'expense_2' }, { ...groceries, id: 'expense_3' }]
    const result = summarize(rows, untouched({ accountId: 'cash' }))

    expect(result.rows).toEqual([{ label: 'Move to account', value: 'Cash', detail: '3 move' }])
  })

  it('shows what a tracked From end moves and records across a transfer pair', () => {
    const choice = untouched({
      transferFrom: { scope: 'tracked', accountId: 'cash', currency: 'CAD' },
      endsAreOffered: true,
    })
    const result = summarize(pair, choice)

    expect(result.rows).toEqual([{
      label: 'From',
      value: 'Cash',
      detail: '1 out of 2 moves into Cash, 1 out of 2 now comes from Cash',
    }])
    // Both rows are transfers whose own account it moves or records, so leftAlone stays at zero and
    // only the other-half note, not the not-a-transfer note, is left standing
    expect(result.notes).toEqual([{
      key: 'other-half',
      text: 'Adjustments to a transfer affect the selected transaction only and do not update its counterpart.',
    }])
  })

  it('hides the records clause once it is true of the one row selected', () => {
    const choice = untouched({ transferFrom: { scope: 'outside' }, endsAreOffered: true })
    const result = summarize([savingsHalf], choice)

    expect(result.rows).toEqual([{ label: 'From', value: 'Outside this app' }])
    expect(result.warnings).toEqual([])
  })

  it('drops the detail and no longer warns once the own end resolves outside instead', () => {
    const choice = untouched({ transferFrom: { scope: 'outside' }, endsAreOffered: true })
    const result = summarize([chequingHalf], choice)

    expect(result.rows).toEqual([{ label: 'From', value: 'Outside this app' }])
    expect(result.warnings).toEqual([])
  })

  it('answers a To end across a transfer pair and leaves a plain expense to its own note', () => {
    const rows = [chequingHalf, savingsHalf, groceries]
    const choice = untouched({
      transferTo: { scope: 'tracked', accountId: 'savings', currency: 'CAD' },
      endsAreOffered: true,
    })
    const result = summarize(rows, choice)

    // The Savings half's own end already sits in Savings, so it neither moves nor records and the
    // detail carries only the Chequing half's records clause
    expect(result.rows).toEqual([{
      label: 'To',
      value: 'Savings',
      detail: '1 out of 3 now goes to Savings',
    }])
    expect(result.notes).toEqual([
      {
        key: 'other-half',
        text: 'Adjustments to a transfer affect the selected transaction only and do not update its counterpart.',
      },
      { key: 'left-alone', text: 'Changes to From and To apply only to 2 out of 3 selected transactions.' },
    ])
  })

  it('hides the records clause once it is true of every selected row, while still warning about the far side matching the own account', () => {
    const choice = untouched({
      direction: 'credit',
      transferFrom: { scope: 'tracked', accountId: 'chequing', currency: 'CAD' },
      endsAreOffered: true,
    })
    const result = summarize(pair, choice)

    expect(result.rows).toEqual([
      { label: 'Direction', value: 'Credit' },
      { label: 'From', value: 'Chequing' },
    ])
    expect(result.warnings).toEqual([{
      key: 'own-account',
      text: '1 out of 2 selected transfers can\'t have the same account on both sides.',
    }])
  })

  it('joins chosen tag names with commas', () => {
    const choice = untouched({ tagIds: ['tag_1', 'tag_2'] })
    const result = summarize([groceries], choice, { tagLabels: ['Holiday', 'Cash'] })

    expect(result.rows).toEqual([{ label: 'Tags added', value: 'Holiday, Cash' }])
  })

  it('shows Removed for a cleared note and the typed text for one that was set', () => {
    const cleared = summarize([groceries], untouched({ clearsNote: true }))
    expect(cleared.rows).toEqual([{ label: 'Note', value: 'Removed' }])

    const written = summarize([groceries], untouched({ note: 'paid back' }))
    expect(written.rows).toEqual([{ label: 'Note', value: 'paid back' }])
  })

  it('renders the date the way the day headings do, falling back to the raw string', () => {
    const parseable = summarize([groceries], untouched({ date: '2026-08-23' }))
    expect(parseable.rows).toEqual([{ label: 'Date', value: 'August 23, 2026' }])

    // The year rolls to 1900 under the Date constructor's two-digit-year rule and fails the
    // round-trip check parseYmd uses to reject it, the same as it does for the day headings
    const unparseable = summarize([groceries], untouched({ date: '0000-01-01' }))
    expect(unparseable.rows).toEqual([{ label: 'Date', value: '0000-01-01' }])
  })

  it('warns about an unanswered far side even with no end chosen', () => {
    const result = summarize([unanswered], untouched())

    expect(result.warnings).toEqual([{
      key: 'unanswered',
      text: 'The selected transfer is missing the To or From account.',
    }])
  })

  it('drops a stale From end once endsAreOffered goes false', () => {
    const choice = untouched({
      transferFrom: { scope: 'tracked', accountId: 'cash', currency: 'CAD' },
      endsAreOffered: false,
    })
    const result = summarize(pair, choice)

    expect(result.rows).toEqual([])
    expect(result.notes).toEqual([])
  })

  it('falls back to Account for an id the label lookup does not know', () => {
    const result = summarize([groceries], untouched({ accountId: 'unknown_account' }))

    expect(result.rows).toEqual([{ label: 'Move to account', value: 'Account', detail: '1 move' }])
  })

  it('warns once per currency pair, each keyed by its own pair, when a tracked end mismatches more than one row currency', () => {
    const choice = untouched({
      transferFrom: { scope: 'tracked', accountId: 'us_savings', currency: 'USD' },
      endsAreOffered: true,
    })
    const result = summarize([chequingHalf, eurExpense], choice)

    expect(result.warnings).toEqual([
      {
        key: 'currency-CAD-USD',
        text: "1 out of 2 selected transactions in CAD can't move to a USD account.",
      },
      {
        key: 'currency-EUR-USD',
        text: "1 out of 2 selected transactions in EUR can't move to a USD account.",
      },
    ])
  })

  it('shows nothing for an empty selection, whatever the controls still hold', () => {
    const choice = untouched({ date: '2026-08-23', accountId: 'cash' })

    expect(summarize([], choice)).toEqual({ rows: [], notes: [], warnings: [] })
  })

  it('warns proportionally when only one of two selected rows is missing a merchant', () => {
    const result = summarize([oldImport, groceries], untouched())

    expect(result.warnings).toEqual([{
      key: 'without-merchant',
      text: '1 out of 2 selected transactions is missing merchant information.',
    }])
  })

  it('scales the unanswered-far-side warning to the transfer rows in a larger mixed selection', () => {
    const rows = [
      { ...unanswered, id: 'unanswered_1' },
      { ...unanswered, id: 'unanswered_2' },
      { ...unanswered, id: 'unanswered_3' },
      groceries,
      { ...groceries, id: 'expense_2' },
    ]
    const result = summarize(rows, untouched())

    expect(result.warnings).toEqual([{
      key: 'unanswered',
      text: '3 out of 5 selected transfers are missing the To or From account.',
    }])
  })

  it('notes the transfer share and details a tracked To end alongside a plain expense', () => {
    const rows = [chequingHalf, savingsHalf, groceries]
    const choice = untouched({
      transferTo: { scope: 'tracked', accountId: 'cash', currency: 'CAD' },
      endsAreOffered: true,
    })
    const result = summarize(rows, choice)

    expect(result.rows).toEqual([{
      label: 'To',
      value: 'Cash',
      detail: '1 out of 3 moves into Cash, 1 out of 3 now goes to Cash',
    }])
    expect(result.notes).toEqual([
      {
        key: 'other-half',
        text: 'Adjustments to a transfer affect the selected transaction only and do not update its counterpart.',
      },
      { key: 'left-alone', text: 'Changes to From and To apply only to 2 out of 3 selected transactions.' },
    ])
  })

  it('hides the From detail once its move count reaches every selected row', () => {
    const rows = [chequingHalf, chequingHalf2]
    const choice = untouched({
      transferFrom: { scope: 'tracked', accountId: 'cash', currency: 'CAD' },
      endsAreOffered: true,
    })
    const result = summarize(rows, choice)

    expect(result.rows).toEqual([{ label: 'From', value: 'Cash' }])
  })

  it('details a tracked To end moving and recording across a transfer pair', () => {
    const choice = untouched({
      transferTo: { scope: 'tracked', accountId: 'cash', currency: 'CAD' },
      endsAreOffered: true,
    })
    const result = summarize(pair, choice)

    expect(result.rows).toEqual([{
      label: 'To',
      value: 'Cash',
      detail: '1 out of 2 moves into Cash, 1 out of 2 now goes to Cash',
    }])
  })

  it('shows the other-half note only once a direction reaches the transfer row', () => {
    const withoutDirection = summarize([chequingHalf], untouched({ clearsNote: true }))
    expect(withoutDirection.notes).toEqual([])

    const withReverse = summarize([chequingHalf], untouched({ clearsNote: true, direction: 'reverse' }))
    expect(withReverse.notes).toEqual([{
      key: 'other-half',
      text: 'Adjustments to a transfer affect the selected transaction only and do not update its counterpart.',
    }])
  })

  it('lists an implied direction over rows that are not all transfers with which rows it reaches, unlike one the user picked', () => {
    const rows = [chequingHalf, savingsHalf, groceries]

    const implied = summarize(rows, untouched({ direction: 'credit', directionIsImplied: true, endsAreOffered: true }))
    expect(implied.rows).toEqual([
      { label: 'Direction', value: 'Credit', detail: 'applies to 2 out of 3 selected transactions' },
    ])

    const picked = summarize(rows, untouched({ direction: 'credit', directionIsImplied: false, endsAreOffered: true }))
    expect(picked.rows).toEqual([{ label: 'Direction', value: 'Credit' }])
  })
})
