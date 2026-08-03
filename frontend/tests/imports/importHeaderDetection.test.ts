/**
 * Tests whether a file's first row is read as headings or as data, which decides whether that row
 * is staged as a transaction and whether the columns carry the file's own names
 */
import { describe, expect, it } from 'vitest'
import { buildParsedCsv } from '@/pages/imports/utils'

const SUPPORTED_CURRENCY_CODES = new Set(['CAD', 'USD', 'EUR', 'JPY'])

/**
 * Splits CSV text into the records the parser hands over, dropping blank lines the way it does
 */
function toRecords(csv: string) {
  return csv
    .trim()
    .split('\n')
    .map((line) => line.split(',').map((cell) => cell.trim()))
}

/**
 * Reads CSV text the way a staged file is built from it
 */
function stage(csv: string) {
  return buildParsedCsv(toRecords(csv), SUPPORTED_CURRENCY_CODES)
}

describe('detecting a header row', () => {
  it('reads a row of terse bank headings as headings, not as a transaction', () => {
    // Every one of these is three letters, and asking the browser whether a code was a currency
    // answered yes to all four, so the row scored as four data cells and was staged as a row
    const parsed = stage(
      'Day,Ref,Amt,Cur\n2026-04-11,INV-1,-12.34,CAD\n2026-04-12,INV-2,-8.00,CAD',
    )

    expect(parsed.hasHeaderRow).toBe(true)
    expect(parsed.headers).toEqual(['Day', 'Ref', 'Amt', 'Cur'])
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toMatchObject({ Day: '2026-04-11', Amt: '-12.34', Cur: 'CAD' })
  })

  it('reads a heading row mixing a known alias with terse words as headings', () => {
    // One recognized alias was not enough to save this row, because the data-like count only had
    // to match the alias count rather than beat it
    const parsed = stage('Date,Amt,Ref\n2026-04-11,-12.34,INV-1\n2026-04-12,-8.00,INV-2')

    expect(parsed.hasHeaderRow).toBe(true)
    expect(parsed.headers).toEqual(['Date', 'Amt', 'Ref'])
    expect(parsed.rows).toHaveLength(2)
  })

  it('reads a currency code the app does not support as an ordinary word', () => {
    // A single data-like cell in the first row was enough to rule the whole row out as headings,
    // and ZZZ counted as one because the browser accepts any three letters
    const parsed = stage('Day,Ref,ZZZ\n2026-04-11,-12.34,x\n2026-04-12,-8.00,y')

    expect(parsed.hasHeaderRow).toBe(true)
    expect(parsed.headers).toEqual(['Day', 'Ref', 'ZZZ'])
  })

  it('still reads a first row of real values as data, with columns numbered by position', () => {
    const parsed = stage('2026-04-11,-12.34,CAD\n2026-04-12,-8.00,CAD')

    expect(parsed.hasHeaderRow).toBe(false)
    expect(parsed.headers).toEqual(['Column 1', 'Column 2', 'Column 3'])
    expect(parsed.rows).toHaveLength(2)
  })

  it('still reads a supported code in a row of values as the currency it is', () => {
    const parsed = stage('Chequing,CAD,x\nSavings,CAD,y')

    expect(parsed.hasHeaderRow).toBe(false)
    expect(parsed.headers).toEqual(['Column 1', 'Column 2', 'Column 3'])
  })
})
