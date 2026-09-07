import { describe, expect, it } from 'vitest'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { ImportFileDraft } from '@/pages/imports/types'
import {
  buildImportAmountFormatScope,
  buildImportDateFormatScope,
  chooseImportFormat,
  createImportFormatChoiceState,
  getImportAmountFormatValues,
  moveImportFormatChoiceToScope,
  resolveImportFormatChoice,
  scanImportAmountFormatChoices,
  scanImportDateFormatChoices,
} from '@/pages/imports/utils/formatChoices'

/** Creates a staged file for format scope and amount-column scans */
function createFile(id: string, rows: ImportFileDraft['rows']): ImportFileDraft {
  return {
    id,
    name: `${id}.csv`,
    size: 100,
    headers: Object.keys(rows[0] ?? {}),
    hasHeaderRow: true,
    rows,
    error: null,
  }
}

describe('automatic date format choices', () => {
  it('requires a choice when the same value has two different calendar readings', () => {
    const scan = scanImportDateFormatChoices(['03.04.2026'])

    expect(scan.readable).toEqual(['dayFirst', 'monthFirst'])
    expect(scan.automatic).toBeNull()
    expect(scan.ambiguous).toBe(true)
  })

  it('chooses a date order when every viable reading agrees', () => {
    const scan = scanImportDateFormatChoices(['12.12.2026'])

    expect(scan.automatic).toBe('dayFirst')
    expect(scan.ambiguous).toBe(false)
  })

  it('accepts mixed row separators under automatic and refuses them under custom period', () => {
    expect(scanImportDateFormatChoices(['2026/08/30', '2026-08-31']).automatic).toBe('yearFirst')
    expect(scanImportDateFormatChoices(['2026/08/30', '2026-08-31'], '.').readable).toEqual([])
  })

  it('refuses a year-first value whose separators differ', () => {
    expect(scanImportDateFormatChoices(['2026.08/31']).readable).toEqual([])
  })
})

describe('automatic amount format choices', () => {
  it('requires a choice when a separator has two numeric meanings', () => {
    const scan = scanImportAmountFormatChoices(['1,234'])

    expect(scan.automatic).toBeNull()
    expect(scan.ambiguous).toBe(true)
    expect(new Set(scan.readable.map((format) => format.decimalSeparator))).toEqual(new Set(['.', ',']))
  })

  it('uses the existing decimal-point convention when all candidates agree', () => {
    const scan = scanImportAmountFormatChoices(['1234'])

    expect(scan.automatic).toEqual({ decimalSeparator: '.', groupingSeparator: ',' })
    expect(scan.ambiguous).toBe(false)
  })

  it('treats equivalent zero spellings as the same interpretation', () => {
    const scan = scanImportAmountFormatChoices(['10', '0,000'])

    expect(scan.automatic).toEqual({ decimalSeparator: '.', groupingSeparator: ',' })
    expect(scan.ambiguous).toBe(false)
  })

  it('compares signed zeroes and leading zeroes exactly', () => {
    const scan = scanImportAmountFormatChoices(['0010', '-0,000', '+00010'])

    expect(scan.automatic).toEqual({ decimalSeparator: '.', groupingSeparator: ',' })
    expect(scan.ambiguous).toBe(false)
  })

  it.each([' ', '\u00a0', '\u202f'])(
    'detects comma decimals grouped with the supported space variant %j',
    (space) => {
      expect(scanImportAmountFormatChoices([`1${space}234,56`, `2${space}345,67`]).automatic)
        .toEqual({ decimalSeparator: ',', groupingSeparator: 'space' })
    },
  )

  it('detects period decimals grouped with apostrophes', () => {
    expect(scanImportAmountFormatChoices(["1'234.56", "2'345.67"]).automatic)
      .toEqual({ decimalSeparator: '.', groupingSeparator: "'" })
  })

  it('finds the one format shared by every row', () => {
    expect(scanImportAmountFormatChoices(['1.234,56', '2.345,67']).automatic)
      .toEqual({ decimalSeparator: ',', groupingSeparator: '.' })
  })

  it('reports no shared format when rows use incompatible formats', () => {
    const scan = scanImportAmountFormatChoices(['1,234.56', '1.234,56'])

    expect(scan.readable).toEqual([])
    expect(scan.automatic).toBeNull()
    expect(scan.ambiguous).toBe(false)
  })

  it('scans both side columns under one choice', () => {
    const columnMap = { ...EMPTY_COLUMN_MAP, amount_out: 'Debit', amount_in: 'Credit' }
    const files = [createFile('file-a', [
      { Debit: '1.234,56', Credit: '' },
      { Debit: '', Credit: '2.345,67' },
    ])]

    expect(getImportAmountFormatValues(columnMap, files)).toEqual(['1.234,56', '', '', '2.345,67'])
    expect(scanImportAmountFormatChoices(getImportAmountFormatValues(columnMap, files)).automatic)
      .toEqual({ decimalSeparator: ',', groupingSeparator: '.' })
  })
})

describe('format choice lifetime', () => {
  it('clears a choice through an A to B to A date-column transition', () => {
    const files = [createFile('file-a', [{ 'Date A': '2026-08-31', 'Date B': '31.08.2026' }])]
    const mapA = { ...EMPTY_COLUMN_MAP, dt: 'Date A' }
    const mapB = { ...EMPTY_COLUMN_MAP, dt: 'Date B' }
    const scopeA = buildImportDateFormatScope(mapA, files)
    const scopeB = buildImportDateFormatScope(mapB, files)
    let state = chooseImportFormat(scopeA, 'yearFirst')

    state = moveImportFormatChoiceToScope(state, scopeB)
    state = moveImportFormatChoiceToScope(state, scopeA)

    expect(resolveImportFormatChoice(state, scopeA, null)).toBeNull()
  })

  it('clears a choice when the file changes', () => {
    const map = { ...EMPTY_COLUMN_MAP, amount: 'Amount' }
    const scopeA = buildImportAmountFormatScope(map, [createFile('file-a', [{ Amount: '1,234' }])])
    const scopeB = buildImportAmountFormatScope(map, [createFile('file-b', [{ Amount: '1,234' }])])
    const chosen = chooseImportFormat(scopeA, { decimalSeparator: ',', groupingSeparator: 'none' } as const)

    expect(moveImportFormatChoiceToScope(chosen, scopeB)).toEqual(createImportFormatChoiceState(scopeB))
  })

  it('clears a choice through Amount to sides to Amount while sharing both sides', () => {
    const files = [createFile('file-a', [{ Amount: '1,234', Debit: '', Credit: '' }])]
    const amountMap = { ...EMPTY_COLUMN_MAP, amount: 'Amount' }
    const sidesMap = { ...EMPTY_COLUMN_MAP, amount_out: 'Debit', amount_in: 'Credit' }
    const amountScope = buildImportAmountFormatScope(amountMap, files)
    const sidesScope = buildImportAmountFormatScope(sidesMap, files)
    let state = chooseImportFormat(amountScope, { decimalSeparator: '.', groupingSeparator: ',' } as const)

    state = moveImportFormatChoiceToScope(state, sidesScope)
    state = moveImportFormatChoiceToScope(state, amountScope)

    expect(resolveImportFormatChoice(state, amountScope, null)).toBeNull()
  })

  it('preserves a choice when an unrelated Notes mapping changes', () => {
    const files = [createFile('file-a', [{ Amount: '1,234', Notes: 'Lunch' }])]
    const before = { ...EMPTY_COLUMN_MAP, amount: 'Amount' }
    const after = { ...before, notes: 'Notes' }
    const scope = buildImportAmountFormatScope(before, files)
    const chosen = chooseImportFormat(scope, { decimalSeparator: '.', groupingSeparator: ',' } as const)
    const moved = moveImportFormatChoiceToScope(chosen, buildImportAmountFormatScope(after, files))

    expect(moved).toBe(chosen)
  })
})
