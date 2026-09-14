/**
 * Tests the amount filter chip against the same currency formatter used by transaction rows while
 * preserving the range's compact, single-currency label and its bare upper bound
 *
 * The suite pins Intl to en-US, so CAD is marked as CA$ while USD uses the plain dollar sign
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import type { AmountDraft } from '@/pages/transactions/utils/amountRange'
import { buildAmountRangeLabel } from '@/pages/transactions/utils/amountRangeLabel'
import { formatCurrency } from '@/utils/formatCurrency'

const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'USD', name: 'US Dollar', symbol: 'US$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
  { id: 'IQD', name: 'Iraqi Dinar', symbol: 'ع.د', minor_unit_exponent: 3 },
]

function label(
  amount: AmountDraft,
  amountCurrency: string,
  amountExponent: number,
): string | null {
  return buildAmountRangeLabel({ amount, amountCurrency, amountExponent })
}

describe('amount range chip label', () => {
  it('writes the lower CAD amount exactly as a transaction row does', () => {
    const rowMagnitude = formatCurrency(123456, 'CAD', currencies)

    expect(rowMagnitude).toBe('CA$1,234.56')
    expect(label({ min: '1234.56', max: '' }, 'CAD', 2)).toBe(`${rowMagnitude}–any`)
  })

  it('uses the currency convention rather than noncanonical table symbol text', () => {
    const rowMagnitude = formatCurrency(123456, 'USD', currencies)

    expect(rowMagnitude).toBe('$1,234.56')
    expect(label({ min: '1234.56', max: '' }, 'USD', 2)).toBe(`${rowMagnitude}–any`)
  })

  it('keeps the normal USD and zero-decimal JPY cases aligned', () => {
    expect(label({ min: '1234.56', max: '' }, 'USD', 2)).toBe('$1,234.56–any')
    expect(label({ min: '500000', max: '' }, 'JPY', 0)).toBe('¥500,000–any')
  })

  it('uses the seeded three-decimal scale for the currency-bearing bound', () => {
    const rowMagnitude = formatCurrency(123456, 'IQD', currencies)

    expect(rowMagnitude).toBe('IQD\u00a0123.456')
    expect(label({ min: '123.456', max: '' }, 'IQD', 3)).toBe(`${rowMagnitude}–any`)
  })

  it('keeps the upper bound bare and preserves its entered fraction digits', () => {
    expect(label({ min: '1234.56', max: '2000.00' }, 'CAD', 2)).toBe('CA$1,234.56–2,000.00')
  })

  it('formats a missing or explicit-zero lower bound as currency zero', () => {
    expect(label({ min: '', max: '2000.00' }, 'CAD', 2)).toBe('CA$0.00–2,000.00')
    expect(label({ min: '0', max: '' }, 'CAD', 2)).toBe('CA$0.00–any')
  })

  it('returns no label when neither bound names an amount', () => {
    expect(label({ min: '', max: '' }, 'CAD', 2)).toBeNull()
  })

  it.each([
    ['1.2', 'CA$1.20–any'],
    ['1.', 'CA$1.00–any'],
  ])('normalizes the read-only lower bound for transient input %s without changing the draft', (min, expected) => {
    const amount = { min, max: '' }

    expect(label(amount, 'CAD', 2)).toBe(expected)
    expect(amount).toStrictEqual({ min, max: '' })
  })
})
