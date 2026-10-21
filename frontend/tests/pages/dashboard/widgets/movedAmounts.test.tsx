/**
 * Guards the dashboard's amounts that moved, the recent activity rows and the net worth change,
 * which put a plain hyphen before a negative amount in every language. Both are signed with a plus
 * or a true minus, and a zero stays unsigned
 */
import { MemoryRouter } from 'react-router'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Currency } from '@/api/currency'
import type { Transaction } from '@/api/transactions'
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

import { RecentActivityList } from '@/pages/dashboard/widgets/recent-activity/List'
import { NetWorthMetric } from '@/pages/dashboard/widgets/net-worth/Metric'

/** Pulls the text out of the elements the markup marks with the test id */
function textOf(markup: string, testId: string) {
  const pattern = new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`, 'g')
  return [...markup.matchAll(pattern)].map((match) => match[1])
}

describe('recent activity amounts', () => {
  it('signs money out with a true minus, money in with a plus, and leaves zero unsigned', () => {
    const rows = [-1000, 2500, 0].map((amount, index) => ({
      transaction: { id: `t${index}`, amount, currency: 'USD', dt: '2026-06-01' } as Transaction,
      category: undefined,
      title: `Row ${index}`,
      isIncome: amount > 0,
    }))

    const markup = renderToStaticMarkup(
      <MemoryRouter><RecentActivityList rows={rows} /></MemoryRouter>,
    )

    expect(textOf(markup, 'recent-activity-amount')).toEqual(['−$10.00', '+$25.00', '$0.00'])
  })
})

describe('net worth change', () => {
  it.each([
    [-12_345, '−$123.45'],
    [12_345, '+$123.45'],
    [0, '$0.00'],
  ])('writes a change of %s as %s', (change, expected) => {
    const markup = renderToStaticMarkup(
      <NetWorthMetric netWorth={500_000} netWorthChange={change} displayCurrency="USD" />,
    )

    expect(markup).toContain(`>${expected}<`)
    expect(markup).toContain(`aria-label="Net worth change ${expected}"`)
  })

  it('rounds a gain down and a loss up in size, and net worth down', () => {
    // 1,234,567.00 is 1.2345 million
    const gain = renderToStaticMarkup(
      <NetWorthMetric netWorth={123_456_700} netWorthChange={123_456_700} displayCurrency="USD" />,
    )
    expect(gain).toContain('>≈$1.2M<')
    expect(gain).toContain('>+≈$1.2M<')

    const loss = renderToStaticMarkup(
      <NetWorthMetric netWorth={-123_456_700} netWorthChange={-123_456_700} displayCurrency="USD" />,
    )
    // Net worth rounds down, so a negative one reads larger, and a loss reads larger too
    expect(loss).toContain('>≈($1.3M)<')
    expect(loss).toContain('>−≈$1.3M<')
  })
})
