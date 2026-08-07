/**
 * Tests the shared money formatter, so the currency convention the product renders cannot drift with
 * the region of whatever machine runs the suite or opens the app
 */
import { describe, expect, it } from 'vitest'
import { MONEY_LOCALE, formatCurrency } from '@/utils/formatCurrency'

describe('money formatting', () => {
  // A Node built against an ICU without en-CA resolves this to plain en, where CAD is CA$ again and
  // every assertion below fails for a reason that has nothing to do with the formatter
  it('resolves the pinned locale', () => {
    expect(new Intl.NumberFormat(MONEY_LOCALE).resolvedOptions().locale).toBe('en-CA')
  })

  it('renders one currency convention whatever region the reader is in', () => {
    expect(formatCurrency(123456, 'CAD')).toBe('$1,234.56')
    expect(formatCurrency(123456, 'USD')).toBe('US$1,234.56')
  })

  it('wraps a negative amount in parentheses and leaves zero plain', () => {
    expect(formatCurrency(-123456, 'CAD')).toBe('($1,234.56)')
    expect(formatCurrency(0, 'CAD')).toBe('$0.00')
    // Dividing -0 by the exponent keeps the sign, and accounting style would wrap it, so a zero
    // amount reaching this as -0 has to come out identical to one reaching it as 0
    expect(formatCurrency(-0, 'CAD')).toBe('$0.00')
  })
})
