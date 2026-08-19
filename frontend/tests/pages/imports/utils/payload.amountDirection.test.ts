/**
 * Tests a file that leaves its amounts unsigned and specifies money in or money out in a column of
 * words: the sign each row ends up with, the rows the arrangement refuses, and what stops the commit
 * before any row is judged
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import {
  DIRECTION_ARRANGEMENT_CLASH_ERROR,
  EMPTY_COLUMN_MAP,
  getDirectionValuesAgreeError,
  getUnansweredDirectionValuesError,
  ROW_AMOUNT_BLANK_REASON,
  ROW_AMOUNT_UNREADABLE_REASON,
  ROW_DIRECTION_BLANK_REASON,
  ROW_DIRECTION_SIGN_DISAGREES_REASON,
} from '@/pages/imports/constants'
import type { ColumnMap, CsvRow, ImportAmountDirection, ImportFileDraft } from '@/pages/imports/types'
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

const HEADERS = ['Date', 'Category', 'Amount', 'Type']

const DIRECTION_MAP: ColumnMap = {
  ...EMPTY_COLUMN_MAP,
  dt: 'Date',
  category_id: 'Category',
  amount: 'Amount',
  amount_direction: 'Type',
}

// What a file writing DEBIT and CREDIT settles on, which is also what the app fills in by itself
const DEBIT_CREDIT_ANSWERS: Record<string, ImportAmountDirection> = { debit: 'out', credit: 'in' }

/**
 * Builds a commit payload from the amount and direction cells given, one row per pair
 *
 * @param rows - The Amount cell and the Type cell of each row, in file order
 * @param directionAnswers - What the user said each word means, keyed by the folded value
 * @param columnValidationErrors - What the mapping step found wrong with a column, keyed by heading
 */
function build(
  rows: Array<[string, string]>,
  directionAnswers: Record<string, ImportAmountDirection> = DEBIT_CREDIT_ANSWERS,
  columnMap: ColumnMap = DIRECTION_MAP,
  columnValidationErrors: Record<string, string> = {},
) {
  const csvRows: CsvRow[] = rows.map(([amount, type], index) => ({
    Date: `2026-04-${String(index + 1).padStart(2, '0')}`,
    Category: 'Groceries',
    Amount: amount,
    Type: type,
  }))

  const file: ImportFileDraft = {
    id: 'file-1',
    name: 'Chequing.csv',
    size: 512,
    headers: HEADERS,
    hasHeaderRow: true,
    rows: csvRows,
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
    dateFormat: 'yearFirst',
    directionAnswers,
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

describe('reading a row from the word its direction column carries', () => {
  // The whole point of the arrangement: a statement of positive numbers where the Type column is the
  // only thing saying a purchase is a purchase
  it('signs an unsigned amount from its direction word', () => {
    expect(committedAmounts(build([['84.20', 'DEBIT'], ['1200.00', 'CREDIT']]))).toEqual(['-84.20', '1200.00'])
  })

  it('reads a word however the file capitalises it', () => {
    expect(committedAmounts(build([['84.20', 'Debit'], ['12.00', ' debit ']]))).toEqual(['-84.20', '-12.00'])
  })

  // A minus agrees with a row the direction column calls money out, so the row imports as written.
  // The sign is replaced rather than added in front, which would give --84.20
  it('keeps a sign that agrees with the direction', () => {
    expect(committedAmounts(build([['-84.20', 'DEBIT'], ['+1200.00', 'CREDIT']]))).toEqual(['-84.20', '1200.00'])
  })

  it('leaves thousands separators as the file wrote them', () => {
    expect(committedAmounts(build([['1,234.56', 'DEBIT']]))).toEqual(['-1,234.56'])
  })

  // A zero moves neither way, so it is committed without a sign rather than as -0.00
  it('commits a zero unsigned whichever direction its row carries', () => {
    expect(committedAmounts(build([['0.00', 'DEBIT'], ['0.00', 'CREDIT']]))).toEqual(['0.00', '0.00'])
  })
})

describe('rows this arrangement refuses', () => {
  // Nothing in the app can answer a cell nobody filled in, so the row is listed against its own row
  // number for the user to go and correct in the file
  it('lists the row whose direction cell is blank, and only that row', () => {
    const result = build([['84.20', 'DEBIT'], ['12.00', '']])

    expect(result.rowProblems.map((problem) => problem.reason)).toEqual([ROW_DIRECTION_BLANK_REASON])
    expect(result.rowProblems[0].rowNumber).toBe(2)
  })

  // The file states the direction in a separate column, so an amount signed against it is two
  // cells of one row contradicting each other rather than a reading to choose between
  it('refuses a row whose sign contradicts its direction', () => {
    const result = build([['+84.20', 'DEBIT'], ['-1200.00', 'CREDIT']])

    expect(result.payload).toBeNull()
    expect(result.rowProblems.map((problem) => problem.reason)).toEqual([
      ROW_DIRECTION_SIGN_DISAGREES_REASON,
      ROW_DIRECTION_SIGN_DISAGREES_REASON,
    ])
  })

  // A zero carries no direction to contradict, so a file padding its rows with -0.00 is not refused
  it('reads past a sign on a zero', () => {
    expect(committedAmounts(build([['-0.00', 'CREDIT']]))).toEqual(['0.00'])
  })

  // A zero would import the same either way, so nothing turns on the missing word. The row is still
  // listed, because a cell the file failed to fill in is worth showing the user whatever it holds,
  // and this is the safe side of a case that could be argued the other way
  it('lists a zero row whose direction cell is blank', () => {
    expect(build([['0.00', '']]).rowProblems[0].reason).toBe(ROW_DIRECTION_BLANK_REASON)
  })

  // The cell to go and fix is the amount, so the row is judged against that rather than against a
  // direction that was never the problem
  it('reports an unreadable amount as unreadable, whatever its direction cell holds', () => {
    expect(build([['abc', 'DEBIT']]).rowProblems[0].reason).toBe(ROW_AMOUNT_UNREADABLE_REASON)
    expect(build([['abc', '']]).rowProblems[0].reason).toBe(ROW_AMOUNT_UNREADABLE_REASON)
  })

  it('reports a blank amount as blank, whatever its direction cell holds', () => {
    expect(build([['', 'DEBIT']]).rowProblems[0].reason).toBe(ROW_AMOUNT_BLANK_REASON)
  })
})

describe('what stops the commit before any row is judged', () => {
  // Without the answer every row would be listed as one with no amount, which reads as a broken file
  // rather than as one question waiting on the mapping step
  it('refuses the import while a word has no answer, naming the words', () => {
    const result = build([['84.20', 'Sortie'], ['1200.00', 'Entrée']], {})

    expect(result.payload).toBeNull()
    expect(result.errors).toContain(getUnansweredDirectionValuesError(['Sortie', 'Entrée']))
    expect(result.rowProblems).toEqual([])
  })

  it('names only the word still unanswered', () => {
    const result = build([['84.20', 'DEBIT'], ['1200.00', 'Entrée']], { debit: 'out' })

    expect(result.errors).toContain(getUnansweredDirectionValuesError(['Entrée']))
  })

  // A column whose two words mean the same thing separates nothing, and every row of such a file
  // would import the same way round with nothing reported
  it('refuses two words answered the same way', () => {
    const result = build([['84.20', 'DEBIT'], ['1200.00', 'CREDIT']], { debit: 'out', credit: 'out' })

    expect(result.payload).toBeNull()
    expect(result.errors).toContain(getDirectionValuesAgreeError('out'))
  })

  it('accepts a column of one word', () => {
    const result = build([['84.20', 'DEBIT'], ['12.00', 'DEBIT']], { debit: 'out' })

    expect(committedAmounts(result)).toEqual(['-84.20', '-12.00'])
  })

  // Nothing is asked of a file that carries no Direction column, so the empty answers it is built
  // with cannot refuse it
  it('asks nothing of a file with no direction column', () => {
    const columnMap: ColumnMap = { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category', amount: 'Amount' }
    const result = build([['-84.20', 'DEBIT']], {}, columnMap)

    expect(committedAmounts(result)).toEqual(['-84.20'])
  })

  // The panel that answers these is off screen while the column is refused for holding more words
  // than a direction has, so asking for an answer would point at a control the user cannot see. The
  // column refusal stops the commit on its own
  it('does not ask for answers while the column itself is refused', () => {
    const result = build(
      [['84.20', 'Groceries'], ['12.00', 'Rent'], ['30.00', 'Salary']],
      {},
      DIRECTION_MAP,
      { Type: 'Expected one or two words specifying money in or money out. This column has 3 different values.' },
    )

    expect(result.payload).toBeNull()
    expect(result.errors).not.toContain(getUnansweredDirectionValuesError(['Groceries', 'Rent', 'Salary']))
  })

  // Suppressing that question is not enough on its own. The refusal is reported against the column
  // rather than as one of the errors the build stops at, so the rows would go on to be judged, and
  // every one of them would be listed as an amount that is blank beside the amount it holds
  it('judges no rows while the column itself is refused', () => {
    const result = build(
      [['84.20', 'Groceries'], ['12.00', 'Rent'], ['30.00', 'Salary']],
      {},
      DIRECTION_MAP,
      { Type: 'Expected one or two words specifying money in or money out. This column has 3 different values.' },
    )

    expect(result.rowProblems).toEqual([])
  })

  // The panel is off screen while the file is mapped with a Direction column and a side column at
  // once, so asking for an answer points at a control the user cannot see. The clash is what they
  // have to answer, and it stops the commit on its own
  it('does not ask for answers while the file states its direction twice', () => {
    const clashingMap: ColumnMap = { ...DIRECTION_MAP, amount: '', amount_in: 'Amount' }
    const result = build([['84.20', 'Sortie'], ['1200.00', 'Entrée']], {}, clashingMap)

    expect(result.payload).toBeNull()
    expect(result.errors).toContain(DIRECTION_ARRANGEMENT_CLASH_ERROR)
    expect(result.errors).not.toContain(getUnansweredDirectionValuesError(['Sortie', 'Entrée']))
    expect(result.rowProblems).toEqual([])
  })
})

describe('a direction column whose words share no letters or digits', () => {
  // A bare sign is a direction the app reads, so a file writing its Type column that way arrives
  // answered. Both signs folding to one key would file both under one answer and commit every row
  // the direction the first sign carries
  it('reads a column of bare signs as two directions rather than one', () => {
    expect(committedAmounts(build([['84.20', '-'], ['1200.00', '+']], { '-': 'out', '+': 'in' })))
      .toEqual(['-84.20', '1200.00'])
  })

  // The same collapse for any script other than the Latin alphabet, where the words are not ones the
  // app knows and the user answers both by hand
  it('reads a column written in another script as two directions rather than one', () => {
    expect(committedAmounts(build([['84.20', 'Дебет'], ['1200.00', 'Кредит']], { дебет: 'out', кредит: 'in' })))
      .toEqual(['-84.20', '1200.00'])
  })

  // Two words that fold to one key would be one question, so the second would never be reported as
  // unanswered and its rows would take the first one's answer
  it('asks about each of them separately', () => {
    const result = build([['84.20', 'Дебет'], ['1200.00', 'Кредит']], { дебет: 'out' })

    expect(result.payload).toBeNull()
    expect(result.errors).toContain(getUnansweredDirectionValuesError(['Кредит']))
  })
})
