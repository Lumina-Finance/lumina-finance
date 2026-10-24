/**
 * Guards a budget period that ended with nothing left over and nothing over, which read "Left $0.00"
 * in green. A zero remainder is neutral, with the overspent and left-over periods keeping their colours
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Budget } from '@/api/budgets'

import { getColoursOfText } from './fixtures'

const currencies = [{ id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 }]

vi.mock('@/hooks/useMoneyFormatters', async () => {
  const { formatCurrency } = await import('@/utils/formatCurrency')
  return {
    useMoneyFormatters: () => ({
      formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, currencies),
    }),
  }
})
vi.mock('@/pages/budgets/utils/budgetPeriods', () => ({ formatBudgetPeriod: () => 'Oct 2026' }))

import BudgetPeriodHistory from '@/pages/budgets/components/budget-details-modal/PeriodHistory'

/** Renders one period with the given remainder, which the left and over lines are built from */
function render(remaining: number) {
  return renderToStaticMarkup(createElement(BudgetPeriodHistory, {
    periodHistory: [{ period: { id: 'p', overall_limit: 10_000 } as Budget, spent: 10_000 - remaining, remaining }],
    currency: 'USD',
    loading: false,
    error: false,
  }))
}

/** The colours of the remainder line in both layouts, whose text is the label followed by the amount */
function remainderColours(markup: string, label: string, amount: string) {
  return getColoursOfText(markup, `${label} ${amount}`)
}

describe('budget period history remainder colours', () => {
  it('draws a period with nothing left in the neutral colour', () => {
    expect(remainderColours(render(0), 'Left', '$0.00')).toEqual(Array(2).fill('var(--app-text)'))
  })

  it('keeps green for money left and red for an overspent period', () => {
    expect(remainderColours(render(2_500), 'Left', '$25.00')).toEqual(Array(2).fill('var(--app-positive)'))
    expect(remainderColours(render(-2_500), 'Over', '$25.00')).toEqual(Array(2).fill('var(--app-negative)'))
  })
})
