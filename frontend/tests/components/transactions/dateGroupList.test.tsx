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

const currencies: Currency[] = [{ id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 }]

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies,
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, currencies),
    formatMovedCurrency: (amount: number, currency: string) => formatMovedCurrency(amount, currency, currencies),
  }),
}))

import TransactionDateGroupList from '@/components/transactions/DateGroupList'
import type { TransactionListAccount } from '@/components/transactions/types/transactionList'
import { getDayTotalFxStatusMessage } from '@/components/transactions/utils/transactionDateGroups'
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
    refund_of_transaction_id: null,
    refund_transaction_ids: [],
    created_at: '2026-10-03T00:00:00Z',
    updated_at: '2026-10-03T00:00:00Z',
    tag_ids: [],
    tags: [],
  }
}

const account: TransactionListAccount = {
  id: 'account',
  name: 'Chequing',
  currency: 'USD',
  can_write: true,
  group_id: null,
}

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

describe('a transaction with no exchange rate', () => {
  const converted = transaction('converted', -1_000)
  const unconverted = { ...transaction('unconverted', -2_000), currency: 'EUR', base_currency_amount: null }
  const zero = { ...transaction('zero', 0), base_currency_amount: 0 }

  function renderDay(transactions: Transaction[], extra: object = {}) {
    return renderToStaticMarkup(
      <TransactionDateGroupList
        dateGroups={[{ dateLabel: 'Oct 3, 2026', transactions }]}
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

  /** The tone the badge on a day's heading is drawn in, which the badge states on its button */
  // Reads the tone from the badge's own tag, whatever order its attributes come in
  const badgeTone = (markup: string, dateLabel: string) => {
    const tag = new RegExp(`<[^>]*aria-label="FX status for ${dateLabel}"[^>]*>`).exec(markup)?.[0]
    return tag && /data-fx-tone="(\w+)"/.exec(tag)?.[1]
  }

  const unavailableCount = (markup: string) => markup.split('FX unavailable').length - 1

  it('marks only the unconverted row and gives its day one FX badge, leaving it out of the total', () => {
    const markup = renderDay([converted, unconverted, zero])

    expect(unavailableCount(markup)).toBe(2)
    expect(markup).not.toContain('Rate not published yet')
    expect(markup.split('FX status for Oct 3, 2026').length - 1).toBe(1)
    expect(dayTotal(markup).text).toBe('−$10.00')
  })

  it('shows neither marker nor badge on a day where every amount converted', () => {
    const markup = renderDay([converted, zero])

    expect(unavailableCount(markup)).toBe(0)
    expect(markup).not.toContain('FX status for')
  })

  it('reads the account amount on an account list, where a missing base amount is no problem', () => {
    const markup = renderDay([unconverted], { fixedAccount: account })

    expect(unavailableCount(markup)).toBe(0)
    expect(markup).not.toContain('FX status for')
  })

  // A future-dated row has no rate because none is published yet, which is no failure, so inside the
  // Upcoming section it says so in the neutral colour, and its day heading keeps an FX badge that is
  // neutral too, where a past day's badge is red
  it('says the rate is not published yet on an upcoming row, with a neutral heading badge', () => {
    const markup = renderToStaticMarkup(
      <TransactionDateGroupList
        dateGroups={[]}
        upcomingDateGroups={[{ dateLabel: 'Oct 9, 2026', transactions: [unconverted] }]}
        today="2026-10-01"
        isUpcomingExpanded
        onToggleUpcoming={() => {}}
        categoryMap={new Map()}
        accountMap={new Map([[account.id, account]])}
        currency="USD"
        listRevealKey={0}
        stickyTop={0}
        prefersReducedMotion
        skipEnterAnimation
        onEditTransaction={() => {}}
      />,
    )

    const note = /<span[^>]*style="[^"]*color:([^;"]*)[^"]*"[^>]*>Rate not published yet<\/span>/.exec(markup)
    expect(note?.[1]).toBe('var(--app-text-muted)')
    expect(unavailableCount(markup)).toBe(0)
    expect(badgeTone(markup, 'Oct 9, 2026')).toBe('gray')
    // The markup writes the message's apostrophe as an entity
    expect(markup).toContain(getDayTotalFxStatusMessage(true).replace("'", '&#x27;'))
    expect(markup).not.toContain(getDayTotalFxStatusMessage(false))
  })

  it('draws a past day badge in red with the message about amounts that could not be converted', () => {
    const markup = renderDay([unconverted])

    expect(badgeTone(markup, 'Oct 3, 2026')).toBe('red')
    expect(markup).toContain(getDayTotalFxStatusMessage(false))
    expect(markup).not.toContain(getDayTotalFxStatusMessage(true))
  })

  it('marks a row missing its account amount on an account list even when the base amount exists', () => {
    const missingInAccount = { ...transaction('missing', -2_000), account_amount: null }
    const markup = renderDay([missingInAccount], { fixedAccount: account })

    expect(unavailableCount(markup)).toBe(2)
    expect(markup.split('FX status for Oct 3, 2026').length - 1).toBe(1)
  })
})
