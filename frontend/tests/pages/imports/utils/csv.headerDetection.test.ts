/**
 * Tests whether a file's first row is read as headings or as data, which decides whether that row
 * is staged as a transaction and whether the columns carry the file's own names
 */
import { describe, expect, it } from 'vitest'
import { buildParsedCsv } from '@/pages/imports/utils'

const SUPPORTED_CURRENCY_CODES = new Set(['CAD', 'USD', 'EUR', 'JPY'])

/**
 * Splits CSV text into the records the parser hands over, which for these fixtures is a split on
 * lines and commas with each cell trimmed
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
    // Amt and Ref both counted as currencies under the browser check, so two data-like cells
    // outweighed the one recognized alias and the row was staged as a transaction
    const parsed = stage('Date,Amt,Ref\n2026-04-11,-12.34,INV-1\n2026-04-12,-8.00,INV-2')

    expect(parsed.hasHeaderRow).toBe(true)
    expect(parsed.headers).toEqual(['Date', 'Amt', 'Ref'])
    expect(parsed.rows).toHaveLength(2)
  })

  it('reads a currency code the app does not support as an ordinary word', () => {
    // A single data-like cell in the first row was enough to rule the whole row out as headings,
    // and all three of these counted as one because the browser accepts any three letters
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

  it('keeps a period date and localized amount in the first headerless row', () => {
    const parsed = buildParsedCsv([
      ['31.08.2026', 'CHF100,99'],
      ['01.09.2026', 'CHF200,00'],
    ], SUPPORTED_CURRENCY_CODES)

    expect(parsed.hasHeaderRow).toBe(false)
    expect(parsed.rows[0]).toEqual({ 'Column 1': '31.08.2026', 'Column 2': 'CHF100,99' })
  })

  it('keeps names containing numbers as data rather than amount headings', () => {
    const parsed = buildParsedCsv([
      ['Savings 2.0', 'CAD'],
      ['Chequing 3.0', 'CAD'],
    ], SUPPORTED_CURRENCY_CODES)

    expect(parsed.hasHeaderRow).toBe(false)
    expect(parsed.rows[0]['Column 1']).toBe('Savings 2.0')
  })

  it('still reads aliases with numerical suffixes as headings', () => {
    const parsed = stage('Date,Reference1,Amount2\n2026-04-11,INV-1,-12.34')

    expect(parsed.hasHeaderRow).toBe(true)
    expect(parsed.headers).toEqual(['Date', 'Reference1', 'Amount2'])
  })
})
