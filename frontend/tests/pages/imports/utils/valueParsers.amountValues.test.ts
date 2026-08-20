/**
 * Tests which raw cell values the amount column accepts, told apart from a formatted number, and
 * the truncation every row message quoting a value back to the user runs through
 */
import { describe, expect, it } from 'vitest'
import { isValidAmountValue, truncateValue } from '@/pages/imports/utils/valueParsers'

describe('reading a cell as a raw signed amount', () => {
  // These separate an amount column from a formatted one, and loosening the rule imports a
  // different number than the file states
  it('refuses a formatted number', () => {
    for (const value of ['$5.00', '(5.00)', '1 234', '1.234,56', '1,23']) {
      expect(isValidAmountValue(value)).toBe(false)
    }
  })

  it('accepts a raw signed number, grouped or not', () => {
    for (const value of ['1,234.56', '-12.34', '+5', '0', ' -12.34 ']) {
      expect(isValidAmountValue(value)).toBe(true)
    }
  })

  // The only input that reaches the finite-number guard, since the pattern itself accepts a run of
  // digits this long
  it('refuses a number too long to read as finite', () => {
    expect(isValidAmountValue('9'.repeat(400))).toBe(false)
  })

  it('refuses a blank cell and a value with no digits on both sides of the point', () => {
    for (const value of ['', '-', '12.', '.5', '1e3']) {
      expect(isValidAmountValue(value)).toBe(false)
    }
  })
})

describe('shortening a value for display', () => {
  it('cuts a long value to 25 characters and adds an ellipsis', () => {
    const value = '1234567890123456789012345678901234567890'

    expect(truncateValue(value)).toBe('1234567890123456789012345...')
  })

  it('returns a 25-character value whole, since the cut only touches a value longer than that', () => {
    const value = '1234567890123456789012345'

    expect(truncateValue(value)).toBe(value)
  })
})
