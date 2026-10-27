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
 * non-breaking space, written as an escape so it cannot be retyped as a plain one
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Currency } from '@/api/currency'
import { formatCurrency, formatCurrencyLabel, formatCurrencySymbol, getSymbolInputStyle } from '@/utils/formatCurrency'

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
    expect(formatCurrency(123456, 'PKR', currencies)).toBe('PKR\u00A01,234.56')
    expect(formatCurrency(123456, 'IQD', currencies)).toBe('IQD\u00A0123.456')
    expect(formatCurrency(500000, 'JPY', currencies)).toBe('¥500,000')
  })

  it('falls back to the browser for a code the list does not carry', () => {
    // Reading the browser is right for 139 of the 155 seeded codes. A flat two places instead would
    // render this yen balance as ¥5,000.00, a hundredth of the real amount
    expect(formatCurrency(500000, 'JPY', [])).toBe('¥500,000')
    expect(formatCurrency(123456, 'IQD', [])).toBe('IQD\u00A0123,456')
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

describe('symbol field padding', () => {
  it('leaves a one-character symbol to the field\'s own padding', () => {
    expect(getSymbolInputStyle('$')).toBeUndefined()
    expect(getSymbolInputStyle('')).toBeUndefined()
  })

  it('adds room for each character past the first so CA$ and CHF clear the typed amount', () => {
    expect(getSymbolInputStyle('CA$')).toEqual({ paddingLeft: 'calc(2rem + 1.6rem)' })
    expect(getSymbolInputStyle('CHF')).toEqual({ paddingLeft: 'calc(2rem + 1.6rem)' })
  })

  describe('with text that can be measured', () => {
    // A narrow symbol such as A$ and a wide one such as F CFA, at the widths they draw at
    const WIDTHS: Record<string, number> = { 'A$': 19, 'F CFA': 40 }

    beforeEach(() => {
      const context = { font: '', measureText: (text: string) => ({ width: WIDTHS[text] }) }
      vi.stubGlobal('document', {
        createElement: () => ({ getContext: () => context }),
        documentElement: {},
        body: {},
      })
      vi.stubGlobal('getComputedStyle', () => ({ fontSize: '16px', fontFamily: 'DM Sans' }))
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('starts the amount the same distance past a narrow and a wide symbol', () => {
      const narrow = getSymbolInputStyle('A$')
      const wide = getSymbolInputStyle('F CFA')

      expect(narrow).toEqual({ paddingLeft: '45px' })
      expect(wide).toEqual({ paddingLeft: '66px' })
      // The symbol starts 16px in, so what is left after its width is the same gap for both
      expect(45 - 16 - WIDTHS['A$']).toBe(66 - 16 - WIDTHS['F CFA'])
    })

    it('counts the inset a field draws its symbol at', () => {
      expect(getSymbolInputStyle('A$', { insetRem: 0.75, fontRem: 0.875 })).toEqual({ paddingLeft: '41px' })
    })

    it('estimates instead while the page font is still loading', () => {
      vi.stubGlobal('document', {
        createElement: () => ({ getContext: () => ({ font: '', measureText: () => ({ width: 19 }) }) }),
        documentElement: {},
        body: {},
        fonts: { check: () => false },
      })

      expect(getSymbolInputStyle('A$')).toEqual({ paddingLeft: 'calc(2rem + 0.8rem)' })
    })
  })
})

describe('currency labels', () => {
  it('writes a symbol the way the reader\'s region does, not as the seeded table has it', () => {
    expect(formatCurrencySymbol('CAD')).toBe('CA$')
    expect(formatCurrencySymbol('USD')).toBe('$')
    expect(formatCurrencySymbol('EUR')).toBe('€')
  })

  it('falls back to the code for one the browser rejects', () => {
    expect(formatCurrencySymbol('not-a-code')).toBe('not-a-code')
  })

  it('labels a currency with its code, name and the reader\'s symbol', () => {
    expect(formatCurrencyLabel(currencies[0])).toBe('CAD · Canadian Dollar (CA$)')
    expect(formatCurrencyLabel(currencies[1])).toBe('USD · US Dollar ($)')
  })

  it('leaves the bracket off a currency the reader\'s region writes as its own code', () => {
    expect(formatCurrencyLabel({ id: 'BWP', name: 'Botswana Pula', symbol: 'P', minor_unit_exponent: 2 }))
      .toBe('BWP · Botswana Pula')
  })
})
