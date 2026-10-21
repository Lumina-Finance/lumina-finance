/**
 * Tests compact money formatting, so an expense rounds up and an income rounds down at the unit it is
 * shown in, an amount either side of a threshold is scaled by the same decimal places, the caller's
 * choice of prefix and plain decimals is honoured, and an amount that rounds into the next size is
 * written in that size
 *
 * A currency's symbol is written the reader's way, so the amounts below assume the region the suite
 * pins through LC_ALL in its package script: read from the United States, where US dollars are the
 * plain ones and Canadian dollars are marked CA$
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import { type CompactMoneyRule, formatCompactMoney, formatRoundedMoney } from '@/utils/formatCompactMoney'
import { DASHBOARD_MONEY_RULES } from '@/pages/dashboard/constants/moneyRules'
import { formatCurrency } from '@/utils/formatCurrency'

const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'IQD', name: 'Iraqi Dinar', symbol: 'ع.د', minor_unit_exponent: 3 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
]

const RULES: CompactMoneyRule[] = [
  { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 1 },
  { threshold: 1_000, divisor: 1_000, suffix: 'K', fractionDigits: 1 },
]

describe('compact money formatting', () => {
  it('rounds an expense up and an income down at the tenth of a thousand', () => {
    expect(formatCompactMoney(2_841_00, 'CAD', RULES, currencies, 'up')).toBe('≈CA$2.9K')
    expect(formatCompactMoney(2_841_00, 'CAD', RULES, currencies, 'down')).toBe('≈CA$2.8K')
    // A figure that lands on a step does not move, and keeps its zero decimal
    expect(formatCompactMoney(3_000_00, 'CAD', RULES, currencies, 'up')).toBe('≈CA$3.0K')
    expect(formatCompactMoney(3_000_00, 'CAD', RULES, currencies, 'down')).toBe('≈CA$3.0K')
    // One minor unit past a step moves an expense a whole step
    expect(formatCompactMoney(3_000_01, 'CAD', RULES, currencies, 'up')).toBe('≈CA$3.1K')
  })

  it('rounds at the tenth of a million', () => {
    expect(formatCompactMoney(1_234_567_00, 'CAD', RULES, currencies, 'up')).toBe('≈CA$1.3M')
    expect(formatCompactMoney(1_234_567_00, 'CAD', RULES, currencies, 'down')).toBe('≈CA$1.2M')
  })

  it('reads a negative held amount the less favourable way', () => {
    // Net worth rounds down, so a debt-heavy figure reads larger, not smaller
    expect(formatCompactMoney(-2_841_00, 'CAD', RULES, currencies, 'down')).toBe('≈(CA$2.9K)')
    expect(formatCompactMoney(-2_841_00, 'CAD', RULES, currencies, 'up')).toBe('≈(CA$2.8K)')
  })

  it('compacts once an amount crosses a threshold', () => {
    expect(formatCompactMoney(123_456_789_00, 'CAD', RULES, currencies, 'down')).toBe('≈CA$123.4M')
    expect(formatCompactMoney(1_234_56, 'CAD', RULES, currencies, 'down')).toBe('≈CA$1.2K')
  })

  it('renders an amount below every threshold in full, cents included, whichever way it rounds', () => {
    // IQD has three decimal places, and the browser reports none, so an amount falling through to
    // the full formatter has to scale the same way one that was compacted does
    expect(formatCompactMoney(999_999, 'IQD', RULES, currencies, 'up')).toBe(formatCurrency(999_999, 'IQD', currencies))
    expect(formatCompactMoney(999_99, 'CAD', RULES, currencies, 'down')).toBe('CA$999.99')
    expect(formatCompactMoney(999_99, 'CAD', RULES, currencies, 'up')).toBe('CA$999.99')
  })

  it('takes the caller\'s decimals for an amount below every threshold and rounds them', () => {
    // Without this the meters would show cents on a small amount and whole units on a large one
    const whole = { prefix: '', plainFractionDigits: 0 }
    expect(formatCompactMoney(500_00, 'CAD', RULES, currencies, 'up', whole)).toBe('CA$500')
    expect(formatCompactMoney(500_01, 'CAD', RULES, currencies, 'up', whole)).toBe('CA$501')
    expect(formatCompactMoney(500_99, 'CAD', RULES, currencies, 'down', whole)).toBe('CA$500')
  })

  it('rounds an axis tick to the nearest, keeping its own digits', () => {
    const axis: CompactMoneyRule[] = [{ threshold: 1_000, divisor: 1_000, suffix: 'K', fractionDigits: 0 }]
    expect(formatCompactMoney(2_841_00, 'CAD', axis, currencies, 'nearest', { prefix: '' })).toBe('CA$3K')
    expect(formatCompactMoney(2_441_00, 'CAD', axis, currencies, 'nearest', { prefix: '' })).toBe('CA$2K')
  })

  it('promotes an amount that rounds up to the next rule\'s threshold into that rule', () => {
    // 999,950 is 999.95 thousand, which rounds up to "1,000.0K" inside the thousands rule
    expect(formatCompactMoney(999_950_00, 'CAD', RULES, currencies, 'up')).toBe('≈CA$1.0M')
    expect(formatCompactMoney(-999_950_00, 'CAD', RULES, currencies, 'down')).toBe('≈(CA$1.0M)')
    // Rounded down it stays in thousands, and so does an expense one step short
    expect(formatCompactMoney(999_950_00, 'CAD', RULES, currencies, 'down')).toBe('≈CA$999.9K')
    expect(formatCompactMoney(999_900_00, 'CAD', RULES, currencies, 'up')).toBe('≈CA$999.9K')
  })

  it('promotes an amount that rounds up to a threshold at the caller\'s plain decimals', () => {
    // 999.01 is shown whole as 1,000 when it rounds up, which is the first rule's threshold, so it
    // reads as that rule rather than as a full amount sitting beside "≈CA$1.0K"
    const whole = { plainFractionDigits: 0 }
    expect(formatCompactMoney(999_01, 'CAD', RULES, currencies, 'up', whole)).toBe('≈CA$1.0K')
    expect(formatCompactMoney(999_01, 'CAD', RULES, currencies, 'down', whole)).toBe('CA$999')
  })

  it('rounds in a currency with three decimals and one with none', () => {
    // 2,841.000 dinar is 2,841,000 minor units, and 2,841 yen is 2,841
    expect(formatCompactMoney(2_841_000, 'IQD', RULES, currencies, 'up')).toBe('≈IQD 2.9K')
    expect(formatCompactMoney(2_841_000, 'IQD', RULES, currencies, 'down')).toBe('≈IQD 2.8K')
    expect(formatCompactMoney(2_841, 'JPY', RULES, currencies, 'up')).toBe('≈¥2.9K')
    expect(formatCompactMoney(2_841, 'JPY', RULES, currencies, 'down')).toBe('≈¥2.8K')
    // Whole amounts below the first threshold take the same exponent
    expect(formatCompactMoney(500_001, 'IQD', RULES, currencies, 'up', { plainFractionDigits: 0 })).toBe('IQD 501')
    expect(formatRoundedMoney(500_001, 'IQD', currencies, 0, 'down')).toBe('IQD 500')
  })

  it('rounds a negative axis tick to the nearest', () => {
    const axis: CompactMoneyRule[] = [{ threshold: 1_000, divisor: 1_000, suffix: 'K', fractionDigits: 0 }]
    expect(formatCompactMoney(-2_841_00, 'CAD', axis, currencies, 'nearest', { prefix: '' })).toBe('(CA$3K)')
    expect(formatCompactMoney(-2_500_00, 'CAD', axis, currencies, 'nearest', { prefix: '' })).toBe('(CA$3K)')
  })

  it('keeps an amount on its step without stepping into a larger size', () => {
    const rules = DASHBOARD_MONEY_RULES.breakdown
    const read = (major: number, rounding: 'up' | 'down') =>
      formatCompactMoney(Math.round(major * 100), 'CAD', rules, currencies, rounding)
    // Amounts that divide to a long binary fraction stay on their step
    expect(read(99_900, 'up')).toBe('≈CA$99.9K')
    expect(read(1_100, 'up')).toBe('≈CA$1.1K')
    expect(read(100_000, 'down')).toBe('≈CA$100.0K')
  })
})

describe('rounded money', () => {
  it('writes an amount whole, up or down', () => {
    expect(formatRoundedMoney(1_234_50, 'CAD', currencies, 0, 'up')).toBe('CA$1,235')
    expect(formatRoundedMoney(1_234_50, 'CAD', currencies, 0, 'down')).toBe('CA$1,234')
    expect(formatRoundedMoney(-1_234_50, 'CAD', currencies, 0, 'down')).toBe('(CA$1,235)')
  })
})
