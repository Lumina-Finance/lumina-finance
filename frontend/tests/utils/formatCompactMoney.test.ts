/**
 * Tests compact money formatting, so an amount either side of a threshold is scaled by the same
 * decimal places, the caller's choice of prefix and plain decimals is honoured, and an amount that
 * rounds up into the next size is written in that size
 *
 * A currency's symbol is written the reader's way, so the amounts below assume the region the suite
 * pins through LC_ALL in its package script: read from the United States, where US dollars are the
 * plain ones and Canadian dollars are marked CA$
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import { type CompactMoneyRule, formatCompactMoney } from '@/utils/formatCompactMoney'
import { DASHBOARD_MONEY_RULES } from '@/pages/dashboard/constants/moneyRules'
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

  it('promotes an amount that rounds up to the next rule\'s threshold into that rule', () => {
    // 999,500 is 999.5 thousand, which would round to "1,000K" inside the thousands rule
    expect(formatCompactMoney(999_500_00, 'CAD', RULES, currencies)).toBe('≈CA$1.0M')
    expect(formatCompactMoney(-999_500_00, 'CAD', RULES, currencies)).toBe('≈(CA$1.0M)')
    // One minor unit short of rounding up stays where it is
    expect(formatCompactMoney(999_499_99, 'CAD', RULES, currencies)).toBe('≈CA$999K')
  })

  it('promotes an amount that rounds up to a threshold at the caller\'s plain decimals', () => {
    // 999.99 is shown whole as 1,000, which is the first rule's threshold, so it reads as that rule
    // rather than as a full amount sitting beside "≈CA$1K"
    const whole = { plainFractionDigits: 0 }
    expect(formatCompactMoney(999_99, 'CAD', RULES, currencies, whole)).toBe('≈CA$1K')
    expect(formatCompactMoney(999_49, 'CAD', RULES, currencies, whole)).toBe('CA$999')
  })

  it('promotes across a rule that keeps a decimal', () => {
    const rules: CompactMoneyRule[] = [
      { threshold: 100_000, divisor: 1_000, suffix: 'K', fractionDigits: 0 },
      { threshold: 10_000, divisor: 1_000, suffix: 'K', fractionDigits: 1 },
    ]
    // 99.95 thousand rounds to 100.0 at one decimal
    expect(formatCompactMoney(99_950_00, 'CAD', rules, currencies)).toBe('≈CA$100K')
    expect(formatCompactMoney(99_949_00, 'CAD', rules, currencies)).toBe('≈CA$99.9K')
  })

  it('rounds whole amounts up on the breakdown rules without stepping into a larger size', () => {
    const rules = DASHBOARD_MONEY_RULES.breakdown
    const read = (major: number) => formatCompactMoney(major * 100, 'CAD', rules, currencies)
    // 9,999.50 rounds up to 10.0 thousand, which is the next rule's threshold
    expect(read(9_999.5)).toBe('≈CA$10.0K')
    // Whole amounts that divide to a long binary fraction stay in their own size
    expect(read(99_900)).toBe('≈CA$99.9K')
    expect(read(1_100)).toBe('≈CA$2K')
    expect(read(11_000)).toBe('≈CA$11.0K')
    expect(read(10_100)).toBe('≈CA$10.1K')
    expect(read(100_000)).toBe('≈CA$100K')
  })

  it('promotes a rounded-up ceil amount using the same rule', () => {
    const rules: CompactMoneyRule[] = [
      { threshold: 100_000, divisor: 1_000, suffix: 'K', fractionDigits: 0, rounding: 'ceil' },
      { threshold: 10_000, divisor: 1_000, suffix: 'K', fractionDigits: 1, rounding: 'ceil' },
    ]
    expect(formatCompactMoney(99_900_01, 'CAD', rules, currencies)).toBe('≈CA$100K')
  })
})
