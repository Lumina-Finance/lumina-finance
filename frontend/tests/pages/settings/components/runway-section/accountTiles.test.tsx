/**
 * Guards the runway account tile's balance, which colours by direction and draws a zero in the
 * neutral colour rather than as a gain
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'

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

import { RunwayAccountTile } from '@/pages/settings/components/runway-section/AccountTiles'

describe('runway account tile balance colour', () => {
  it.each([
    [0, '$0.00', 'var(--app-text)'],
    [5_000, '$50.00', 'var(--app-positive)'],
    [-5_000, '($50.00)', 'var(--app-negative)'],
  ])('draws a balance of %s as %s in %s', (balance, text, colour) => {
    const markup = renderToStaticMarkup(createElement(RunwayAccountTile, {
      // Only the fields the tile reads
      account: { name: 'Chequing', institution: null, current_balance: balance, currency: 'USD', credit_limit: null } as AccountsOverview,
      selected: false,
      onToggle: () => {},
    }))

    expect(getColoursOfText(markup, text)).toEqual([colour])
  })
})
