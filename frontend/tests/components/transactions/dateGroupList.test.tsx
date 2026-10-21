/**
 * Guards the day heading's net total on the transactions list. It is an amount that moved, so it
 * took brackets for a negative day and no plus for a positive one, where the rule wants a true
 * minus or a plus. A day that nets to zero stays unsigned in the neutral colour, which the colour
 * check once read as positive. The Upcoming section draws the same heading
 */
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

import TransactionDateGroupList from '@/components/transactions/DateGroupList'
import type { TransactionListAccount } from '@/components/transactions/types/transactionList'
import { UPCOMING_DAY_TOTAL_COLOUR } from '@/components/transactions/UpcomingSection'

function transaction(id: string, amount: number): Transaction {
  return {
    id,
    created_by_user_id: 'user',
    account_id: 'account',
    dt: '2026-10-03',
    merchant_id: null,
    merchant_name: `Merchant ${id}`,
    category_id: 'category',
    amount,
    account_amount: amount,
    base_currency_amount: amount,
    currency: 'USD',
    fx_rate: null,
    notes: null,
    counterparty_account_id: null,
    counterparty_account_scope: null,
    created_at: '2026-10-03T00:00:00Z',
    updated_at: '2026-10-03T00:00:00Z',
    tag_ids: [],
    tags: [],
  }
}

const account: TransactionListAccount = { id: 'account', name: 'Chequing', currency: 'USD', can_write: true, group_id: null }

function renderHeadings(amounts: number[], extra: object = {}) {
  const dateGroups = amounts.length
    ? [{ dateLabel: 'Oct 3, 2026', transactions: amounts.map((amount, index) => transaction(`t${index}`, amount)) }]
    : []
  return renderToStaticMarkup(
    <TransactionDateGroupList
      dateGroups={dateGroups}
      categoryMap={new Map()}
      accountMap={new Map([[account.id, account]])}
      currency="USD"
      listRevealKey={0}
      stickyTop={0}
      prefersReducedMotion
      skipEnterAnimation
      onEditTransaction={() => {}}
      {...extra}
    />,
  )
}

/** Reads the heading's total as its text and its inline colour */
function dayTotal(markup: string) {
  const match = /<p[^>]*data-testid="day-total"[^>]*>([^<]*)<\/p>/.exec(markup)
  if (!match) throw new Error('No day total in the markup')
  const colour = /color:([^;"]*)/.exec(match[0])
  return { colour: colour?.[1], text: match[1] }
}

describe('day heading net total', () => {
  it.each([
    [[-30_000, -20_000], '−$500.00', 'var(--app-negative)'],
    [[5_000, -750], '+$42.50', 'var(--app-positive)'],
    [[1_200, -1_200], '$0.00', 'var(--app-text)'],
  ])('writes a day of %j as %s in %s', (amounts, text, colour) => {
    expect(dayTotal(renderHeadings(amounts))).toEqual({ colour, text })
  })

  it('writes the same total inside the Upcoming section in its muted colour', () => {
    const markup = renderHeadings([], {
      upcomingDateGroups: [{ dateLabel: 'Oct 9, 2026', transactions: [transaction('u', -50_000)] }],
      today: '2026-10-01',
      isUpcomingExpanded: true,
      onToggleUpcoming: () => {},
    })

    expect(dayTotal(markup)).toEqual({ colour: UPCOMING_DAY_TOTAL_COLOUR, text: '−$500.00' })
  })
})
