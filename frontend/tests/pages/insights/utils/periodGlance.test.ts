/**
 * Guards how "This Period at a Glance" writes the amounts that moved. The headline is income minus
 * expenses, a net flow, so a shortfall under "You Overspent" reads with a true minus rather than in
 * the brackets a held balance takes, and a surplus under "You Kept" reads with a plus. The changes
 * beside it follow the same rule
 */
import { describe, expect, it } from 'vitest'
import type { InsightsPeriodGlanceResponse } from '@/api/insights'
import type { Currency } from '@/api/currency'
import { getPeriodGlanceCardData } from '@/pages/insights/utils/periodGlance'

const currencies: Currency[] = [
  { id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 },
]

/** Builds a response for the given income and expenses, with the rest left empty */
function respond(overrides: Partial<InsightsPeriodGlanceResponse>): InsightsPeriodGlanceResponse {
  return {
    income: 0,
    expenses: 0,
    income_expense_fx_status: 'ok',
    net_worth_change: 0,
    net_worth_change_fx_status: 'ok',
    top_category_fx_status: 'ok',
    biggest_change_fx_status: 'ok',
    ...overrides,
  } as InsightsPeriodGlanceResponse
}

describe('period glance amounts that moved', () => {
  it('writes a shortfall under "You Overspent" with a true minus, not in brackets', () => {
    const { primaryMetric } = getPeriodGlanceCardData(respond({ income: 10_000, expenses: 25_000 }), 'USD', currencies)

    expect(primaryMetric.label).toBe('You Overspent')
    expect(primaryMetric.value).toBe('−$150.00')
  })

  it('writes a surplus under "You Kept" with a plus', () => {
    const { primaryMetric } = getPeriodGlanceCardData(respond({ income: 25_000, expenses: 10_000 }), 'USD', currencies)

    expect(primaryMetric.label).toBe('You Kept')
    expect(primaryMetric.value).toBe('+$150.00')
  })

  it('leaves a break-even period unsigned', () => {
    const { primaryMetric } = getPeriodGlanceCardData(respond({ income: 10_000, expenses: 10_000 }), 'USD', currencies)

    expect(primaryMetric.value).toBe('$0.00')
  })

  it('signs the net worth change and the biggest change with a true minus', () => {
    const { supportItems } = getPeriodGlanceCardData(
      respond({ net_worth_change: -4_200, biggest_change_name: 'Dining', biggest_change_amount: -1_000, biggest_change_pct: -10 }),
      'USD',
      currencies,
    )

    expect(supportItems.find((item) => item.label === 'Net Worth Changed By')?.value).toBe('−$42.00')
    expect(supportItems.find((item) => item.label === 'Biggest Change')?.detail)
      .toBe('−$10.00 (-10%) vs previous matching period')
  })
})
