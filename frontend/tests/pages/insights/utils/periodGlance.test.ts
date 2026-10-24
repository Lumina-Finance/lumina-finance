/**
 * Guards how "This Period at a Glance" writes the amounts that moved. The headline is income minus
 * expenses, a net flow, so a shortfall under "You overspent" reads with a true minus rather than in
 * the brackets a held balance takes, and a surplus under "You kept" reads with a plus. The changes
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
  it('writes a shortfall under "You overspent" with a true minus, not in brackets', () => {
    const { primaryMetric } = getPeriodGlanceCardData(respond({ income: 10_000, expenses: 25_000 }), 'USD', currencies)

    expect(primaryMetric.label).toBe('You overspent')
    expect(primaryMetric.value).toBe('−$150.00')
  })

  it('writes a surplus under "You kept" with a plus', () => {
    const { primaryMetric } = getPeriodGlanceCardData(respond({ income: 25_000, expenses: 10_000 }), 'USD', currencies)

    expect(primaryMetric.label).toBe('You kept')
    expect(primaryMetric.value).toBe('+$150.00')
  })

  it('signs the net worth change and the biggest change with a true minus', () => {
    const { supportItems } = getPeriodGlanceCardData(
      respond({ net_worth_change: -4_200, biggest_change_name: 'Dining', biggest_change_amount: -1_000, biggest_change_basis: 10_000 }),
      'USD',
      currencies,
    )

    expect(supportItems.find((item) => item.label === 'Net worth changed by')?.value).toBe('−$42.00')
    expect(supportItems.find((item) => item.label === 'Biggest change')?.detail)
      .toBe('−$10.00 (−10%) vs previous matching period')
  })

  it('leaves a net savings and a net worth change of zero unsigned and neutral, and colours the rest by direction', () => {
    const toneOf = (income: number, expenses: number, netWorthChange: number) => {
      const { primaryMetric, supportItems } = getPeriodGlanceCardData(
        respond({ income, expenses, net_worth_change: netWorthChange }),
        'USD',
        currencies,
      )
      return [
        primaryMetric.value,
        primaryMetric.tone,
        supportItems.find((item) => item.label === 'Net worth changed by')?.tone,
      ]
    }

    expect(toneOf(5_000, 5_000, 0)).toEqual(['$0.00', 'neutral', 'neutral'])
    expect(toneOf(6_000, 5_000, 100)).toEqual(['+$10.00', 'positive', 'positive'])
    expect(toneOf(5_000, 6_000, -100)).toEqual(['−$10.00', 'negative', 'negative'])
  })

  it('rounds the top category share and the biggest change up, like any spending figure', () => {
    // 410,000 of 480,000 is 85.4%, and a 1,001 rise on a 100,000 basis is 1.001%
    const items = getPeriodGlanceCardData(
      respond({
        top_category_name: 'Groceries',
        top_category_amount: 410_000,
        top_category_expense_total: 480_000,
        biggest_change_name: 'Groceries',
        biggest_change_amount: 1_001,
        biggest_change_basis: 100_000,
        biggest_change_kind: 'expense',
      }),
      'USD',
      currencies,
    ).supportItems

    expect(items.find((item) => item.label === 'Top category')?.detail).toBe('86% of recorded expenses')
    expect(items.find((item) => item.label === 'Biggest change')?.detail)
      .toBe('+$10.01 (+2%) vs previous matching period')
  })

  it('rounds a reversed income category down, so its loss never reads smaller than it is', () => {
    // Income of 300 that became a 100 reversal moved by -400, which is -133.33% of the 300
    const detailOf = (kind: 'expense' | 'income') =>
      getPeriodGlanceCardData(
        respond({ biggest_change_name: 'Capital Gains', biggest_change_amount: -400, biggest_change_basis: 300, biggest_change_kind: kind }),
        'USD',
        currencies,
      ).supportItems.find((item) => item.label === 'Biggest change')?.detail

    expect(detailOf('income')).toBe('−$4.00 (−134%) vs previous matching period')
    expect(detailOf('expense')).toBe('−$4.00 (−133%) vs previous matching period')
  })

  it('leaves the percentages out when there is nothing to divide by', () => {
    const items = getPeriodGlanceCardData(
      respond({ biggest_change_name: 'Dining', biggest_change_amount: 500 }),
      'USD',
      currencies,
    ).supportItems

    expect(items.find((item) => item.label === 'Top category')?.detail).toBe('No recorded expenses in this range')
    expect(items.find((item) => item.label === 'Biggest change')?.detail)
      .toBe('+$5.00 vs previous matching period')
  })

  it('rounds the savings rate down, so an exact 14.5% reads 14% and -14.5% reads -15%', () => {
    const savingsRateOf = (income: number, expenses: number) =>
      getPeriodGlanceCardData(respond({ income, expenses }), 'USD', currencies)
        .supportItems.find((item) => item.label === 'Savings rate')?.value

    expect(savingsRateOf(200_000, 171_000)).toBe('14%')
    expect(savingsRateOf(200_000, 229_000)).toBe('−15%')
  })
})
