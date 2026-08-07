/**
 * Tests the shared money formatter, covering the currency convention it renders, which must not drift
 * with the region of whatever machine runs the suite or opens the app, and the decimal places it
 * scales by, which come from the seeded currency list rather than from the browser
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import { MONEY_LOCALE, formatCurrency } from '@/utils/formatCurrency'

// The exponents here are the seeded ones. PKR and IQD are two of the 16 codes the browser's own
// tables disagree about, reporting no decimal places for either
const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'USD', name: 'US Dollar', symbol: 'US$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
  { id: 'PKR', name: 'Pakistani Rupee', symbol: '₨', minor_unit_exponent: 2 },
  { id: 'IQD', name: 'Iraqi Dinar', symbol: 'ع.د', minor_unit_exponent: 3 },
]

describe('money formatting', () => {
  // A Node built against an ICU without en-CA resolves this to plain en, where CAD is CA$ again and
  // every assertion below fails for a reason that has nothing to do with the formatter
  it('resolves the pinned locale', () => {
    expect(new Intl.NumberFormat(MONEY_LOCALE).resolvedOptions().locale).toBe('en-CA')
  })

  it('renders one currency convention whatever region the reader is in', () => {
    expect(formatCurrency(123456, 'CAD', currencies)).toBe('$1,234.56')
    expect(formatCurrency(123456, 'USD', currencies)).toBe('US$1,234.56')
  })

  it('scales by the decimal places the currency list records, not the browser', () => {
    // The browser reports no decimal places for either code, which would render these as
    // PKR 123,456 and IQD 123,456. A code used in place of a symbol is separated by a non-breaking
    // space, written as an escape here so it cannot be retyped as a plain one
    expect(formatCurrency(123456, 'PKR', currencies)).toBe('PKR\u00A01,234.56')
    expect(formatCurrency(123456, 'IQD', currencies)).toBe('IQD\u00A0123.456')
    expect(formatCurrency(500000, 'JPY', currencies)).toBe('JP¥500,000')
  })

  it('falls back to the browser for a code the list does not carry', () => {
    // A list that failed to load leaves the app on what it rendered before the list was read at all,
    // which is right for 139 of the 155 seeded codes. A flat two places instead would render this
    // yen balance as JP\u00A55,000.00, a hundredth of the real amount
    expect(formatCurrency(500000, 'JPY', [])).toBe('JP\u00A5500,000')
    expect(formatCurrency(123456, 'IQD', [])).toBe('IQD\u00A0123,456')
    // A loaded list missing one code takes the same path as no list at all
    expect(formatCurrency(123456, 'JPY', [currencies[0]])).toBe('JP\u00A5123,456')
  })

  it('wraps a negative amount in parentheses and leaves zero plain', () => {
    expect(formatCurrency(-123456, 'CAD', currencies)).toBe('($1,234.56)')
    expect(formatCurrency(0, 'CAD', currencies)).toBe('$0.00')
    // Dividing -0 by the exponent keeps the sign, and accounting style would wrap it, so a zero
    // amount reaching this as -0 has to come out identical to one reaching it as 0
    expect(formatCurrency(-0, 'CAD', currencies)).toBe('$0.00')
  })
})
