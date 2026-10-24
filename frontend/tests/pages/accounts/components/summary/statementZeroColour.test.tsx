/**
 * Guards the accounts summary's net worth and assets, which coloured a zero green because the colour
 * came from `>= 0`. A zero is neutral, and a positive and a negative keep their colours
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

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

import SummaryStatement from '@/pages/accounts/components/summary/Statement'

/** Renders the summary with the given net worth and assets, and no debts */
function render(netWorth: number, totalAssets: number) {
  return renderToStaticMarkup(createElement(SummaryStatement, {
    error: null,
    isLoading: false,
    netWorth,
    totalAssets,
    totalDebts: 0,
    assetCount: 1,
    debtCount: 0,
    displayCurrency: 'USD',
    fxStatus: { state: 'none', missing_pairs: [] },
  }))
}

describe('accounts summary colours', () => {
  it('draws a net worth and assets of zero in the neutral colour', () => {
    expect(getColoursOfText(render(0, 0), '$0.00')).toEqual(Array(3).fill('var(--app-text)'))
  })

  it('keeps green for a positive net worth and assets and red for a negative one', () => {
    expect(getColoursOfText(render(5_000, 5_000), '$50.00')).toEqual(Array(2).fill('var(--app-positive)'))
    expect(getColoursOfText(render(-5_000, -5_000), '($50.00)')).toEqual(Array(2).fill('var(--app-negative)'))
  })
})
