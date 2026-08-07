/**
 * Tests a file that writes money out and money in in columns of their own: which side a row is read
 * from, the sign that side gives it, and the rows the arrangement refuses
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  AMOUNT_ARRANGEMENT_CLASH_ERROR,
  DEFAULT_AMOUNT_SIGN_CONVENTIONS,
  EMPTY_COLUMN_MAP,
  MISSING_AMOUNT_COLUMN_LABEL,
  NO_OUTFLOWS_WARNING,
  ROW_AMOUNT_BOTH_SIDES_REASON,
  ROW_AMOUNT_NO_SIDE_REASON,
  ROW_AMOUNT_SIDE_STATES_ZERO_REASON,
  ROW_AMOUNT_UNREADABLE_REASON,
} from '@/pages/imports/constants'
import type { ColumnMap, CsvRow, ImportAmountSignConventions, ImportFileDraft } from '@/pages/imports/types'
import { buildTransactionImportPayload } from '@/pages/imports/utils'

const CURRENCIES: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
]

const CATEGORY: Category = {
  id: 'category-1',
  group_id: null,
  owner_id: null,
  name: 'Groceries',
  kind: 'expense',
  icon: null,
  is_system: false,
  created_at: '2026-01-01T00:00:00Z',
}

const HEADERS = ['Date', 'Category', 'Debit', 'Credit', 'Amount']

const BOTH_SIDES_MAP: ColumnMap = {
  ...EMPTY_COLUMN_MAP,
  dt: 'Date',
  category_id: 'Category',
  amount_out: 'Debit',
  amount_in: 'Credit',
}

/**
 * Builds a commit payload from the money out and money in cells given, one row per pair
 *
 * @param sides - The Debit cell and the Credit cell of each row, in file order
 * @param columnMap - Which columns the file is mapped as using, defaulting to both sides
 */
function build(
  sides: Array<[string, string]>,
  columnMap: ColumnMap = BOTH_SIDES_MAP,
  columnValidationErrors: Record<string, string> = {},
  amountSignConventions: ImportAmountSignConventions = DEFAULT_AMOUNT_SIGN_CONVENTIONS,
) {
  // The signed column carries what the two sides come to, so a map naming all three is the state a
  // real file reaches rather than one invented for the test
  const rows: CsvRow[] = sides.map(([debit, credit], index) => ({
    Date: `2026-04-${String(index + 1).padStart(2, '0')}`,
    Category: 'Groceries',
    Debit: debit,
    Credit: credit,
    Amount: credit || (debit && `-${debit}`) || '',
  }))

  const file: ImportFileDraft = {
    id: 'file-1',
    name: 'Chequing.csv',
    size: 512,
    headers: HEADERS,
    hasHeaderRow: true,
    rows,
    error: null,
  }

  return buildTransactionImportPayload({
    accountById: new Map(),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    accountCreateTypes: {},
    accountMappings: { 'file-1': 'account-1' },
    accountSources: [{ id: 'file-1', label: 'Chequing.csv', matchText: 'Chequing.csv', isCounterpartyOnly: false }],
    categoryById: new Map([[CATEGORY.id, CATEGORY]]),
    categoryCreateKinds: {},
    categoryMappings: { Groceries: CATEGORY.id },
    categoryTypesBySource: {},
    columnMap,
    columnValidationErrors,
    currencies: CURRENCIES,
    amountSignConventions,
    dateFormat: 'yearFirst',
    files: [file],
    importedCategories: ['Groceries'],
  })
}

/**
 * Reads the amounts a build committed, in row order
 */
function committedAmounts(result: ReturnType<typeof build>) {
  return result.payload?.rows.map((row) => row.amount) ?? []
}

describe('reading a row from the side that carries its amount', () => {
  it('signs the money out side and leaves the money in side alone', () => {
    expect(committedAmounts(build([['45.00', ''], ['', '1200.00']]))).toEqual(['-45.00', '1200.00'])
  })

  // The layout this arrangement exists for: a bank that pads the unused side with a zero rather than
  // leaving it blank. Reading a zero as a stated amount would make every row hold two
  it('reads past a zero on the unused side', () => {
    expect(committedAmounts(build([['0.00', '45.00'], ['12.34', '0.00']]))).toEqual(['45.00', '-12.34'])
  })

  // The column is written as positive numbers, so a minus on one value runs against it and that row
  // is a refund. The sign is replaced rather than added in front, which would give --45.00
  it('reads a minus in the money out column as a refund', () => {
    expect(committedAmounts(build([['-45.00', '']]))).toEqual(['45.00'])
  })

  // The mirror of the row above, and the reason each side answers for itself: a minus in a column of
  // deposits is a reversal, money leaving the account
  it('reads a minus in the money in column as a reversal', () => {
    expect(committedAmounts(build([['', '-30.00']]))).toEqual(['-30.00'])
  })

  it('reads a value written +45.00 the same way as one written 45.00', () => {
    expect(committedAmounts(build([['+45.00', '']]))).toEqual(['-45.00'])
  })

  it('leaves thousands separators as the file wrote them', () => {
    expect(committedAmounts(build([['1,234.56', '']]))).toEqual(['-1,234.56'])
  })

  // Zero runs neither way, so it is committed without a sign rather than as -0.00. Both sides being
  // mapped is what makes this a row where no money moved, rather than one whose money went the way
  // the file has no mapped column for
  it('commits a row that states only a zero, unsigned', () => {
    expect(committedAmounts(build([['0.00', '']]))).toEqual(['0.00'])
    expect(committedAmounts(build([['0.00', '0.00']]))).toEqual(['0.00'])
  })

  it('reads a file that maps only the money out side', () => {
    const columnMap: ColumnMap = { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount_out: 'Debit' }

    expect(committedAmounts(build([['45.00', ''], ['12.34', '']], columnMap))).toEqual(['-45.00', '-12.34'])
  })

  // With one column to state it in, every row has to state its amount there, so a zero is a row
  // whose money went the way this file has no mapped column for. Committing it as 0.00 would drop a
  // real transaction without saying anything. It is told apart from a row that states nothing at
  // all, because the table shows the user the zero the row does hold
  it('refuses a zero row where only one side is mapped, saying the column states zero', () => {
    const columnMap: ColumnMap = { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount_out: 'Debit' }
    const result = build([['0.00', ''], ['12.34', '']], columnMap)

    expect(result.rowProblems.map((problem) => [problem.rowNumber, problem.reason]))
      .toEqual([[1, ROW_AMOUNT_SIDE_STATES_ZERO_REASON]])
  })

  // Either side answers the amount requirement on its own, so a debit-only file is not told it is
  // missing a column it does not have
  it('does not report a missing amount column where only one side is mapped', () => {
    const columnMap: ColumnMap = { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount_out: 'Debit' }
    const errors = build([['45.00', '']], columnMap).errors

    expect(errors.some((error) => error.includes(MISSING_AMOUNT_COLUMN_LABEL))).toBe(false)
  })
})

describe('refusing a row the two sides cannot be read from', () => {
  /**
   * Reads why each refused row was refused, against the row it was refused on
   */
  function refusals(result: ReturnType<typeof build>) {
    return result.rowProblems.map((problem) => [problem.rowNumber, problem.reason])
  }

  it('refuses a row stating an amount on both sides', () => {
    expect(refusals(build([['45.00', '30.00']]))).toEqual([[1, ROW_AMOUNT_BOTH_SIDES_REASON]])
  })

  it('refuses a row stating an amount on neither side', () => {
    expect(refusals(build([['', '']]))).toEqual([[1, ROW_AMOUNT_NO_SIDE_REASON]])
  })

  // The column check refuses such a column before any row is judged, so this only decides which cell
  // a row is reported against if one ever gets past it
  it('reports a cell that is not a number against the cell rather than calling the row blank', () => {
    expect(refusals(build([['abc', '']]))).toEqual([[1, ROW_AMOUNT_UNREADABLE_REASON]])
  })

  it('leaves the readable rows importable around a refused one', () => {
    const result = build([['45.00', ''], ['12.00', '9.00'], ['', '30.00']])

    expect(refusals(result)).toEqual([[2, ROW_AMOUNT_BOTH_SIDES_REASON]])
    expect(result.payload).toBeNull()
  })

  // One bad cell beside one good one is a row with a cell to go and fix, not a row stating two
  // amounts, and sending the user looking for a second amount would waste the trip
  it('reports the unreadable cell where the other side holds a real amount', () => {
    expect(refusals(build([['abc', '45.00']]))).toEqual([[1, ROW_AMOUNT_UNREADABLE_REASON]])
    expect(refusals(build([['45.00', 'abc']]))).toEqual([[1, ROW_AMOUNT_UNREADABLE_REASON]])
  })
})

describe('reading a side written with a minus sign', () => {
  const SIGNED_OUT: ImportAmountSignConventions = { amount_out: 'negative', amount_in: 'positive' }
  const SIGNED_IN: ImportAmountSignConventions = { amount_out: 'positive', amount_in: 'negative' }

  // Answered on the column rather than guessed, so a statement writing every purchase as a negative
  // imports as purchases rather than as income
  it('takes a negative money out value as money going out', () => {
    expect(committedAmounts(build([['-84.31', '']], BOTH_SIDES_MAP, {}, SIGNED_OUT))).toEqual(['-84.31'])
  })

  // The flipped entry under this convention, which is the one the column does not write with a minus
  it('takes an unsigned money out value as a refund', () => {
    expect(committedAmounts(build([['35.00', '']], BOTH_SIDES_MAP, {}, SIGNED_OUT))).toEqual(['35.00'])
  })

  it('takes a negative money in value as money coming in', () => {
    expect(committedAmounts(build([['', '-2100.00']], BOTH_SIDES_MAP, {}, SIGNED_IN))).toEqual(['2100.00'])
  })

  it('takes an unsigned money in value as a reversal', () => {
    expect(committedAmounts(build([['', '30.00']], BOTH_SIDES_MAP, {}, SIGNED_IN))).toEqual(['-30.00'])
  })

  // Each side answers for itself, which is why the two controls are separate rather than shared
  it('reads each side under its own answer', () => {
    const mixed: ImportAmountSignConventions = { amount_out: 'negative', amount_in: 'positive' }
    const amounts = committedAmounts(build([['-84.31', ''], ['', '2100.00']], BOTH_SIDES_MAP, {}, mixed))

    expect(amounts).toEqual(['-84.31', '2100.00'])
  })

  it('leaves thousands separators alone whichever way the row runs', () => {
    expect(committedAmounts(build([['-1,234.56', '']]))).toEqual(['1,234.56'])
  })

  // The one thing left standing between a wrongly answered convention and a file imported backwards,
  // now that a sign carrying the other direction is read rather than refused. The suggested category
  // kinds come off these same amounts, so nothing else in the flow disagrees with the reading
  it('warns where the answer leaves every row reading as money coming in', () => {
    const result = build([['-84.31', ''], ['-12.40', '']])

    expect(committedAmounts(result)).toEqual(['84.31', '12.40'])
    expect(result.warnings).toContain(NO_OUTFLOWS_WARNING)
    expect(result.payload).not.toBeNull()
  })

  it('says nothing once the convention is answered and the rows read as money going out', () => {
    expect(build([['-84.31', '']], BOTH_SIDES_MAP, {}, SIGNED_OUT).warnings).toEqual([])
  })

  // A month of nothing but deposits and the two sides mapped the wrong way round hold identical
  // columns, so this asks about both. A warning nobody needed costs less than a month of spending
  // imported as income
  it('asks about a two-sided file whose money out column is empty on every row', () => {
    const result = build([['', '2100.00'], ['', '50.00'], ['', '12.00']])

    expect(committedAmounts(result)).toEqual(['2100.00', '50.00', '12.00'])
    expect(result.warnings).toContain(NO_OUTFLOWS_WARNING)
    expect(result.payload).not.toBeNull()
  })

  // The one arrangement it skips, since every row of such a file is positive whatever the data says
  // and the warning would fire on every import
  it('says nothing where money in is the one amount column mapped', () => {
    const columnMap: ColumnMap = { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount_in: 'Credit' }

    expect(build([['', '2100.00'], ['', '50.00']], columnMap).warnings).toEqual([])
  })

  // Zero runs neither way, so no convention gives it a sign
  it('writes a zero unsigned under either answer', () => {
    expect(committedAmounts(build([['0.00', '']], BOTH_SIDES_MAP, {}, SIGNED_OUT))).toEqual(['0.00'])
  })
})

describe('blocking a commit the amount mapping cannot support', () => {
  // A single signed column and the two sides are alternatives, so a map holding both states the
  // amount twice with nothing to say which reading wins
  it('refuses a file mapped with a signed column and a side at once', () => {
    const clashingMap: ColumnMap = { ...BOTH_SIDES_MAP, amount: 'Amount' }
    const result = build([['45.00', '']], clashingMap)

    expect(result.errors).toContain(AMOUNT_ARRANGEMENT_CLASH_ERROR)
    expect(result.payload).toBeNull()
  })

  it('says nothing about a file using one arrangement', () => {
    expect(build([['45.00', '']]).errors).not.toContain(AMOUNT_ARRANGEMENT_CLASH_ERROR)
  })

  // The column check is what refuses a side holding something that is not a number, and its message
  // has to reach the commit rather than stopping at the mapping step
  it('refuses a file whose money out column failed its own check', () => {
    const message = 'Expected a raw number. Row 1 has "pending", which does not match.'
    const result = build([['45.00', '']], BOTH_SIDES_MAP, { Debit: message })

    expect(result.errors).toContain(message)
    expect(result.payload).toBeNull()
  })
})
