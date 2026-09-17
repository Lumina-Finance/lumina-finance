/**
 * Tests which raw cell values the amount column accepts, told apart from a formatted number, and
 * the truncation every row message quoting a value back to the user runs through
 */
import { describe, expect, it } from 'vitest'
import { isValidAmountValue, truncateValue } from '@/pages/imports/utils/valueParsers'

// Full set removed by ECMAScript trim, including the BOM that Python's default strip leaves
// in place
const ECMASCRIPT_TRIM_CHARACTERS = [
  '\u0009', '\u000A', '\u000B', '\u000C', '\u000D', '\u0020', '\u00A0', '\u1680',
  '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2007',
  '\u2008', '\u2009', '\u200A', '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF',
]

describe('reading a cell as a raw signed amount', () => {
  // These separate an amount column from a formatted one, and loosening the rule imports a
  // different number than the file states
  it('refuses a formatted number', () => {
    for (const value of ['$5.00', 'CHF100,99', '(5.00)', '1 234', '1.234,56', '1,23', '12abc34']) {
      expect(isValidAmountValue(value)).toBe(false)
    }
  })

  it('accepts a raw signed number, grouped or not', () => {
    for (const value of ['1,234.56', '-12.34', '+5', '0', ' -12.34 ']) {
      expect(isValidAmountValue(value)).toBe(true)
    }
  })

  it('accepts every ECMAScript trim character at either end', () => {
    for (const padding of ECMASCRIPT_TRIM_CHARACTERS) {
      expect(isValidAmountValue(`${padding}+1,234.56${padding}`)).toBe(true)
    }
    expect(isValidAmountValue('\uFEFF \t-0.00\u3000')).toBe(true)
  })

  it('refuses non-ASCII decimal digits and non-ECMAScript padding', () => {
    for (const value of [
      '١٢.٣٤', '１２.３４', '١2.34', '12.3٤', '1,23٤.56', '𝟙2.34',
      '12.34\u001C', '12.34\u001D', '12.34\u001E', '12.34\u001F', '12.34\u0085',
      '\u000012.34', '\u180E12.34', '\u200B12.34',
    ]) {
      expect(isValidAmountValue(value)).toBe(false)
    }
  })

  // The only input that reaches the finite-number guard, since the pattern itself accepts a run of
  // digits this long
  it('refuses a number too long to read as finite', () => {
    expect(isValidAmountValue('9'.repeat(400))).toBe(false)
  })

  it('refuses a blank cell and a value with no digits on both sides of the point', () => {
    for (const value of ['', ' \t\uFEFF', '-', '12.', '.5', '1e3', '12 34']) {
      expect(isValidAmountValue(value)).toBe(false)
    }
  })
})

describe('shortening a value for display', () => {
  it('cuts a long value to 25 characters and adds an ellipsis', () => {
    const value = '1234567890123456789012345678901234567890'

    expect(truncateValue(value)).toBe('1234567890123456789012345...')
  })

  // The cut is on longer than 28, not on longer than the 25 it keeps, so a value of 26, 27 or 28
  // characters is left alone rather than shortened to something barely different
  it('returns a 28-character value whole and shortens a 29-character one', () => {
    const value = '12345678901234567890123456789'

    expect(truncateValue(value.slice(0, 28))).toBe('1234567890123456789012345678')
    expect(truncateValue(value)).toBe('1234567890123456789012345...')
  })
})
