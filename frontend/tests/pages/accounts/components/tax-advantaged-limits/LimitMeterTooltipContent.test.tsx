/**
 * Tests the tax-advantaged meter tooltip, which once rounded its amounts to whole dollars. A tooltip
 * shows the exact amount at the currency's own decimal places, never rounded or abbreviated, so a yen
 * limit has none, a dinar one has three, and a very large amount keeps every digit
 *
 * The amounts assume the region the suite pins through LC_ALL: read from the United States
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Currency } from '@/api/currency'
import { formatCurrency } from '@/utils/formatCurrency'

const currencies: Currency[] = [
  { id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
  { id: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KD', minor_unit_exponent: 3 },
]

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies,
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, currencies),
  }),
}))

import { TaxAdvantagedLimitMeterTooltipContent } from '@/pages/accounts/components/tax-advantaged-limits/LimitMeterTooltipContent'

/** Reads the used and remaining values out of the rendered rows, in that order */
function renderedValues(used: number, remaining: number, currency: string) {
  const markup = renderToStaticMarkup(
    <TaxAdvantagedLimitMeterTooltipContent label="FHSA" used={used} remaining={remaining} currency={currency} />,
  )
  return [...markup.matchAll(/font-financial[^>]*>([^<]*)</g)].map((match) => match[1])
}

describe('tax-advantaged meter tooltip amounts', () => {
  it.each([
    // Cents that rounding to the dollar, up or down, would hide
    ['USD', 123_456, 876_544, ['$1,234.56', '$8,765.44']],
    // A currency with no decimals writes none, and does not gain any
    ['JPY', 1_234_567, 7_654_321, ['¥1,234,567', '¥7,654,321']],
    // A currency with three decimals keeps all three
    ['KWD', 1_234_567, 7_654_321, ['KWD 1,234.567', 'KWD 7,654.321']],
    // Far past the K and M sizes, with nothing abbreviated
    ['USD', 123_456_789_012_345, 987_654_321_098_765, ['$1,234,567,890,123.45', '$9,876,543,210,987.65']],
  ])('writes %s used %s and remaining %s exactly', (currency, used, remaining, expected) => {
    expect(renderedValues(used, remaining, currency)).toEqual(expected)
  })

  it('writes room over the limit as an exact negative', () => {
    expect(renderedValues(1_000_050, -150, 'USD')).toEqual(['$10,000.50', '($1.50)'])
  })
})
