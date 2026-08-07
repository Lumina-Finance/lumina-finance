/**
 * Tests the shared money formatter, covering the currency convention it renders and the decimal
 * places it scales by, which come from the seeded currency list rather than from the browser
 *
 * The symbol a currency is written with is the reader's own convention, so these assertions only hold
 * for one region. The suite pins itself to en-US through LC_ALL in the test script, which is why a
 * Canadian dollar reads CA$ below: that is what a reader in the United States correctly sees, and a
 * reader in Canada sees the opposite. The first test fails legibly if that pinning ever stops working
 *
 * Where a code stands in place of a symbol, PKR and IQD below, what separates it from the digits is a
 * non-breaking space rather than a plain one. It is invisible in this file, so an assertion that
 * looks right and fails on the separator is what to suspect first
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import { formatCurrency } from '@/utils/formatCurrency'

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
  it('runs in the region every assertion below assumes', () => {
    expect(new Intl.NumberFormat().resolvedOptions().locale).toBe('en-US')
  })

  it('writes the reader\'s own currency bare and marks the rest', () => {
    // Read from the United States, so US dollars are the plain ones and Canadian dollars are marked
    expect(formatCurrency(123456, 'USD', currencies)).toBe('$1,234.56')
    expect(formatCurrency(123456, 'CAD', currencies)).toBe('CA$1,234.56')
  })

  it('scales by the decimal places the currency list records, not the browser', () => {
    // The browser reports no decimal places for either code, so without the list these would render
    // as PKR 123,456 and IQD 123,456
    expect(formatCurrency(123456, 'PKR', currencies)).toBe('PKR 1,234.56')
    expect(formatCurrency(123456, 'IQD', currencies)).toBe('IQD 123.456')
    expect(formatCurrency(500000, 'JPY', currencies)).toBe('¥500,000')
  })

  it('falls back to the browser for a code the list does not carry', () => {
    // Reading the browser is right for 139 of the 155 seeded codes. A flat two places instead would
    // render this yen balance as ¥5,000.00, a hundredth of the real amount
    expect(formatCurrency(500000, 'JPY', [])).toBe('¥500,000')
    expect(formatCurrency(123456, 'IQD', [])).toBe('IQD 123,456')
    // A loaded list missing one code takes the same path as no list at all
    expect(formatCurrency(123456, 'JPY', [currencies[0]])).toBe('¥123,456')
  })

  it('wraps a negative amount in parentheses and leaves zero plain', () => {
    expect(formatCurrency(-123456, 'CAD', currencies)).toBe('(CA$1,234.56)')
    expect(formatCurrency(0, 'CAD', currencies)).toBe('CA$0.00')
    // Dividing -0 by the exponent keeps the sign, and accounting style would wrap it, so a zero
    // amount reaching this as -0 has to come out identical to one reaching it as 0
    expect(formatCurrency(-0, 'CAD', currencies)).toBe('CA$0.00')
  })
})
