/**
 * Tests the type each imported category name is suggested as, which is read off the direction of the
 * amounts filed against it, whichever arrangement the file writes those amounts in
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_AMOUNT_SIGN_CONVENTIONS, EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type {
  ColumnMap,
  CsvRow,
  ImportAmountSignConventions,
  ImportFileDraft,
} from '@/pages/imports/types'
import { getImportedCategoryTypes } from '@/pages/imports/utils'

/**
 * Creates a one-file draft from the given headers and rows
 */
function createFile(headers: string[], rows: CsvRow[]): ImportFileDraft {
  return {
    id: 'file-1',
    name: 'Chequing.csv',
    size: 1024,
    headers,
    hasHeaderRow: true,
    rows,
    error: null,
  }
}

const SIGNED_MAP: ColumnMap = { ...EMPTY_COLUMN_MAP, category_id: 'Category', amount: 'Amount' }
const BOTH_SIDES_MAP: ColumnMap = {
  ...EMPTY_COLUMN_MAP,
  category_id: 'Category',
  amount_out: 'Debit',
  amount_in: 'Credit',
}

describe('suggesting a type from a single signed amount column', () => {
  const files = [createFile(['Category', 'Amount'], [
    { Category: 'Groceries', Amount: '-12.34' },
    { Category: 'Salary', Amount: '2100.00' },
    { Category: 'Travel', Amount: '-40.00' },
    { Category: 'Travel', Amount: '15.00' },
  ])]

  it('reads each name off the direction of its rows', () => {
    expect(getImportedCategoryTypes(files, SIGNED_MAP, DEFAULT_AMOUNT_SIGN_CONVENTIONS, ['Groceries', 'Salary', 'Travel'])).toEqual({
      Groceries: 'Expense',
      Salary: 'Income',
      Travel: 'Mixed',
    })
  })

  it('leaves a name blank until an arrangement carrying the amount is mapped', () => {
    const withoutAmount = { ...EMPTY_COLUMN_MAP, category_id: 'Category' }

    expect(getImportedCategoryTypes(files, withoutAmount, DEFAULT_AMOUNT_SIGN_CONVENTIONS, ['Groceries'])).toEqual({ Groceries: '' })
  })
})

describe('suggesting a type from money out and money in columns', () => {
  // Read through the same derivation the commit uses. Reading the raw cells instead leaves every
  // name blank, since neither column carries the sign the direction used to come from
  it('reads the direction from the column each amount sits in', () => {
    const files = [createFile(['Category', 'Debit', 'Credit'], [
      { Category: 'Groceries', Debit: '12.34', Credit: '0.00' },
      { Category: 'Salary', Debit: '0.00', Credit: '2100.00' },
      { Category: 'Travel', Debit: '40.00', Credit: '' },
      { Category: 'Travel', Debit: '', Credit: '15.00' },
    ])]

    expect(getImportedCategoryTypes(files, BOTH_SIDES_MAP, DEFAULT_AMOUNT_SIGN_CONVENTIONS, ['Groceries', 'Salary', 'Travel'])).toEqual({
      Groceries: 'Expense',
      Salary: 'Income',
      Travel: 'Mixed',
    })
  })

  // A row stating nothing, or stating both, says nothing about direction, and it is refused later
  // against its row number rather than counted here
  it('ignores a row the two sides cannot be read from', () => {
    const files = [createFile(['Category', 'Debit', 'Credit'], [
      { Category: 'Groceries', Debit: '12.34', Credit: '0.00' },
      { Category: 'Groceries', Debit: '', Credit: '' },
      { Category: 'Groceries', Debit: '5.00', Credit: '9.00' },
    ])]

    expect(getImportedCategoryTypes(files, BOTH_SIDES_MAP, DEFAULT_AMOUNT_SIGN_CONVENTIONS, ['Groceries'])).toEqual({ Groceries: 'Expense' })
  })

  it('reads a file that maps only the money out side', () => {
    const files = [createFile(['Category', 'Debit'], [
      { Category: 'Groceries', Debit: '12.34' },
    ])]
    const columnMap: ColumnMap = { ...EMPTY_COLUMN_MAP, category_id: 'Category', amount_out: 'Debit' }

    expect(getImportedCategoryTypes(files, columnMap, DEFAULT_AMOUNT_SIGN_CONVENTIONS, ['Groceries'])).toEqual({ Groceries: 'Expense' })
  })

  // A refund in the debit column runs the other way, so the name it is filed under holds both
  // directions. Reading the raw cells instead would call it an expense and hide the refund
  it('reads a refund in the money out column as the other direction', () => {
    const files = [createFile(['Category', 'Debit', 'Credit'], [
      { Category: 'Groceries', Debit: '12.34', Credit: '' },
      { Category: 'Groceries', Debit: '-4.00', Credit: '' },
    ])]

    expect(getImportedCategoryTypes(files, BOTH_SIDES_MAP, DEFAULT_AMOUNT_SIGN_CONVENTIONS, ['Groceries']))
      .toEqual({ Groceries: 'Mixed' })
  })

  // The convention reaches this reading too, so a column answered as written with a minus is not
  // read as a column of refunds
  it('reads a side answered as written with a minus sign under that answer', () => {
    const files = [createFile(['Category', 'Debit', 'Credit'], [
      { Category: 'Groceries', Debit: '-12.34', Credit: '' },
      { Category: 'Groceries', Debit: '-4.00', Credit: '' },
    ])]
    const signedOut: ImportAmountSignConventions = { amount_out: 'negative', amount_in: 'positive' }

    expect(getImportedCategoryTypes(files, BOTH_SIDES_MAP, signedOut, ['Groceries']))
      .toEqual({ Groceries: 'Expense' })
  })
})
