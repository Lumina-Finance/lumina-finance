/**
 * Guards the runway account tile's balance, which colours by direction, draws a zero in the neutral colour
 * rather than as a gain, and takes the darker positive green wherever the accent tint lies under it: on a
 * chosen tile and under the pointer
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'

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

function renderTile(balance: number, selected: boolean) {
  return renderToStaticMarkup(
    createElement(RunwayAccountTile, {
      // Only the fields the tile reads
      account: {
        name: 'Chequing',
        institution: null,
        current_balance: balance,
        currency: 'USD',
        credit_limit: null,
      } as AccountsOverview,
      selected,
      onToggle: () => {},
    }),
  )
}

/** The colours a balance's text takes at rest and under the pointer */
function getBalanceColours(markup: string) {
  return {
    atRest: /--balance-text:([^;"]*)/.exec(markup)?.[1],
    underPointer: /--balance-tinted-text:([^;"]*)/.exec(markup)?.[1],
  }
}

describe('runway account tile balance colour', () => {
  it.each([
    [0, 'var(--app-text)', 'var(--app-text)'],
    [5_000, 'var(--app-positive)', 'var(--app-positive-on-accent-tint)'],
    [-5_000, 'var(--app-negative)', 'var(--app-negative)'],
  ])('draws a balance of %s in %s, and %s under the pointer', (balance, atRest, underPointer) => {
    expect(getBalanceColours(renderTile(balance, false))).toEqual({ atRest, underPointer })
  })

  it('draws a positive balance in the darker green at rest on a chosen tile, which rests in the accent tint', () => {
    expect(getBalanceColours(renderTile(5_000, true))).toEqual({
      atRest: 'var(--app-positive-on-accent-tint)',
      underPointer: 'var(--app-positive-on-accent-tint)',
    })
  })
})
