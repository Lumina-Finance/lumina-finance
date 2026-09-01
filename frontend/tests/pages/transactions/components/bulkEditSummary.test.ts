/**
 * Tests what the bulk edit summary panel shows for a given choice: the rows it sends, the notes
 * beside them, and the warnings that hold Apply disabled
 */
import { describe, expect, it } from 'vitest'
import { MAX_BULK_EDIT_TRANSACTIONS } from '@/pages/transactions/components/bulk-edit/constants'
import { getBulkEditBlockers, type BulkEditChoice, type SelectedTransactionFacts } from '@/pages/transactions/components/bulk-edit/selection'
import { describeBulkEdit, type BulkEditSummary, type BulkEditSummaryLabels } from '@/pages/transactions/components/bulk-edit/summary'
import { chequingHalf, eurExpense, groceries, oldImport, pair, savingsHalf, unanswered, untouched } from './bulkEditFixtures'

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

describe('the rows, notes and warnings a bulk edit choice produces', () => {
  it('shows nothing while nothing is chosen over a clean pair', () => {
    expect(summarize(pair, untouched())).toEqual({ rows: [], notes: [], warnings: [] })
  })

  it('warns about a merchant-less row even while nothing else is chosen', () => {
    const result = summarize([oldImport], untouched())

    expect(result.rows).toEqual([])
    expect(result.warnings).toEqual([
      '1 selected transaction has no merchant recorded. Set a merchant above, or close this and untick it.',
    ])
  })

  it('shows the direction row and the other-half note over a transfer selection', () => {
    const choice = untouched({ direction: 'debit', endsAreOffered: true })
    const result = summarize(pair, choice)

    expect(result.rows).toEqual([{ label: 'Direction', value: 'Money out' }])
    expect(result.notes).toEqual([
      "A transfer's other half is a separate row. This changes only the rows selected.",
    ])
  })

  it('shows the direction row with no note over a plain expense selection', () => {
    const expenses = [groceries, { ...groceries, id: 'expense_2' }, { ...groceries, id: 'expense_3' }]
    const choice = untouched({ direction: 'reverse', endsAreOffered: false })
    const result = summarize(expenses, choice)

    expect(result.rows).toEqual([{ label: 'Direction', value: 'Turned around' }])
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
      detail: '1 moves into Cash, 1 records Cash as the other side',
    }])
    // Both rows are transfers whose own account it moves or records, so leftAlone stays at zero and
    // only the other-half note, not the not-a-transfer note, is left standing
    expect(result.notes).toEqual([
      "A transfer's other half is a separate row. This changes only the rows selected.",
    ])
  })

  it('shows only a records clause once the From end is outside this app', () => {
    const choice = untouched({ transferFrom: { scope: 'outside' }, endsAreOffered: true })
    const result = summarize([savingsHalf], choice)

    expect(result.rows).toEqual([{
      label: 'From',
      value: 'Outside this app',
      detail: '1 records the other side as outside this app',
    }])
    expect(result.warnings).toEqual([])
  })

  it('drops the detail and warns once the own end resolves outside instead', () => {
    const choice = untouched({ transferFrom: { scope: 'outside' }, endsAreOffered: true })
    const result = summarize([chequingHalf], choice)

    expect(result.rows).toEqual([{ label: 'From', value: 'Outside this app' }])
    expect(result.warnings).toEqual([
      '1 selected transaction would sit outside this app. Money leaves from or arrives in one of your accounts, so pick one for From or To, or close this and untick it.',
    ])
  })

  it('answers a To end across a transfer pair and leaves a plain expense to its own note', () => {
    const rows = [chequingHalf, savingsHalf, groceries]
    const choice = untouched({
      transferTo: { scope: 'tracked', accountId: 'savings', currency: 'CAD' },
      endsAreOffered: true,
    })
    const result = summarize(rows, choice)

    expect(result.rows).toEqual([{
      label: 'To',
      value: 'Savings',
      detail: '1 moves into Savings, 1 records Savings as the other side',
    }])
    expect(result.notes).toEqual([
      "A transfer's other half is a separate row. This changes only the rows selected.",
      '1 selected transaction is not a transfer and is left as it is.',
    ])
  })

  it('keeps the records clause plural while warning about the far side matching the own account', () => {
    const choice = untouched({
      direction: 'credit',
      transferFrom: { scope: 'tracked', accountId: 'chequing', currency: 'CAD' },
      endsAreOffered: true,
    })
    const result = summarize(pair, choice)

    expect(result.rows).toEqual([
      { label: 'Direction', value: 'Money in' },
      { label: 'From', value: 'Chequing', detail: '2 record Chequing as the other side' },
    ])
    expect(result.warnings).toEqual([
      '1 selected transaction would end up recording the account it already sits in. Change From, To or Move to account, or close this and untick it.',
    ])
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

    expect(result.warnings).toEqual([
      '1 selected transfer does not record where the money went. Set From or To above, or close this and untick it.',
    ])
  })

  it('warns once the selection is over the cap', () => {
    const overCap = Array.from({ length: MAX_BULK_EDIT_TRANSACTIONS + 1 }, (_, index) => ({
      ...groceries,
      id: `row_${index}`,
    }))
    const result = summarize(overCap, untouched())

    expect(result.warnings).toEqual([
      `One edit covers at most ${MAX_BULK_EDIT_TRANSACTIONS} transactions. Untick some to continue.`,
    ])
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

  it('warns once per currency pair when a tracked end mismatches more than one row currency', () => {
    const choice = untouched({
      transferFrom: { scope: 'tracked', accountId: 'us_savings', currency: 'USD' },
      endsAreOffered: true,
    })
    const result = summarize([chequingHalf, eurExpense], choice)

    expect(result.warnings).toEqual([
      '1 selected transaction is in CAD and would move into an account in USD. Pick an account in CAD, or close this and untick it.',
      '1 selected transaction is in EUR and would move into an account in USD. Pick an account in EUR, or close this and untick it.',
    ])
  })

  it('shows nothing for an empty selection, whatever the controls still hold', () => {
    const choice = untouched({ date: '2026-08-23', accountId: 'cash' })

    expect(summarize([], choice)).toEqual({ rows: [], notes: [], warnings: [] })
  })
})
