/**
 * Guards the transactions overview's amounts that moved. The net flow showed a negative in brackets
 * and the daily chart's net in brackets too, where the rule wants a plus or a true minus, and a zero
 * stays unsigned. Inflow and outflow are magnitudes under their own labels and stay unsigned
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Currency } from '@/api/currency'
import { formatCurrency, formatMovedCurrency } from '@/utils/formatCurrency'

const currencies: Currency[] = [
  { id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 },
]

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies,
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, currencies),
    formatMovedCurrency: (amount: number, currency: string) => formatMovedCurrency(amount, currency, currencies),
  }),
}))

import NetFlowSummary from '@/pages/transactions/components/top-band/NetFlowSummary'
import { DailyCashFlowTooltipContent } from '@/pages/transactions/components/top-band/DailyCashFlowChart'
import type { DailyCashFlowPoint } from '@/pages/transactions/utils/dailyCashFlowChart'

/** Pulls the visible text out of rendered markup */
function textOf(markup: string) {
  return markup.replace(/<[^>]+>/g, '|').split('|').filter(Boolean)
}

describe('net flow summary', () => {
  it.each([
    [-5_000, 0, '−$50.00'],
    [5_000, 0, '+$50.00'],
    [0, 0, '$0.00'],
  ])('writes inflow %s and outflow %s as %s', (inflow, outflow, expected) => {
    const markup = renderToStaticMarkup(
      <NetFlowSummary inflow={inflow} outflow={outflow} fxStatus={undefined} displayCurrency="USD" />,
    )

    expect(textOf(markup)).toContain(expected)
  })

  it('leaves inflow and outflow as magnitudes', () => {
    const markup = renderToStaticMarkup(
      <NetFlowSummary inflow={8_000} outflow={-3_000} fxStatus={undefined} displayCurrency="USD" />,
    )

    expect(textOf(markup)).toEqual(expect.arrayContaining(['+$50.00', '$80.00', '$30.00']))
  })
})

describe('daily cash flow tooltip', () => {
  it.each([
    [-5_000, '−$50.00'],
    [5_000, '+$50.00'],
    [0, '$0.00'],
  ])('writes a net of %s as %s and leaves inflow and outflow as magnitudes', (net, expected) => {
    const point = { key: 'day', rangeLabel: 'Jun 1', net, inflow: 2_000, outflow: -7_000 } as unknown as DailyCashFlowPoint
    const markup = renderToStaticMarkup(<DailyCashFlowTooltipContent point={point} displayCurrency="USD" mode="net" />)

    expect(textOf(markup)).toEqual(expect.arrayContaining([expected, '$20.00', '$70.00']))
  })
})
