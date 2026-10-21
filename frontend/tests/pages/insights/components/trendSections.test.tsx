/**
 * Guards the income and expense breakdown's drivers, whose percentage change describes an amount
 * that moved and so carries the same true minus as the amount beside it, never a hyphen
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

import { IncomeExpenseTrendSections } from '@/pages/insights/components/income-expense-breakdown-card/TrendSections'

describe('breakdown trend drivers', () => {
  it('writes a driver that fell 12 percent with a true minus on the amount and the percentage', () => {
    const sections = [{
      id: 'decreases' as const,
      label: 'Biggest decreases',
      drivers: [{ id: 'd', name: 'Dining', amount: 8_800, previousAmount: 10_000, changePct: -12, transactionCount: 3 }],
    }]

    const markup = renderToStaticMarkup(
      <IncomeExpenseTrendSections
        mode="expense"
        sections={sections}
        displayCurrency="USD"
        animationKey="k"
        shouldReduceMotion
      />,
    )
    const text = markup.replace(/<[^>]+>/g, '')

    expect(text).toContain('−$12.00')
    expect(text).toContain('(−12%)')
    expect(text).not.toContain('-12%')
  })
})
