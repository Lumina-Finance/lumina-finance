/**
 * Tests compact money formatting, so an amount either side of a threshold is scaled by the same
 * decimal places and the caller's choice of prefix and plain decimals is honoured
 *
 * A currency's symbol is written the reader's way, so the amounts below assume the region the suite
 * pins through LC_ALL in its package script: read from the United States, where US dollars are the
 * plain ones and Canadian dollars are marked CA$
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import { type CompactMoneyRule, formatCompactMoney } from '@/utils/formatCompactMoney'
import { formatCurrency } from '@/utils/formatCurrency'

const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'IQD', name: 'Iraqi Dinar', symbol: 'ع.د', minor_unit_exponent: 3 },
]

const RULES: CompactMoneyRule[] = [
  { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 1 },
  { threshold: 1_000, divisor: 1_000, suffix: 'K', fractionDigits: 0 },
]

describe('compact money formatting', () => {
  it('compacts once an amount crosses a threshold', () => {
    expect(formatCompactMoney(123_456_789_00, 'CAD', RULES, currencies)).toBe('≈CA$123.5M')
    expect(formatCompactMoney(1_234_56, 'CAD', RULES, currencies)).toBe('≈CA$1K')
  })

  it('renders an amount below every threshold at the currency decimals the list records', () => {
    // IQD has three decimal places, and the browser reports none, so an amount falling through to
    // the full formatter has to scale the same way one that was compacted does
    expect(formatCompactMoney(999_999, 'IQD', RULES, currencies))
      .toBe(formatCurrency(999_999, 'IQD', currencies))
    expect(formatCompactMoney(999_999, 'IQD', RULES, currencies)).toBe('IQD\u00A0999.999')
  })

  it('takes the caller\'s decimals for an amount below every threshold', () => {
    // Without this the meters would show cents on a small amount and whole units on a large one
    expect(formatCompactMoney(50_000, 'CAD', RULES, currencies, {
      prefix: '',
      plainFractionDigits: 0,
    })).toBe('CA$500')
  })
})
