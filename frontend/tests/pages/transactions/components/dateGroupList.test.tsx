/**
 * Guards each day's net on the transactions list, an amount that moved: it was written as a held
 * amount, so a day of spending read in parentheses and a day of income had no plus, and a day that
 * netted to zero showed green. The same heading totals an account's own list and the days in the
 * Upcoming section, which must sign the same way and keep the financial face. Also guards the
 * heading as what names a row's date to a screen reader, since the row has no date of its own
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Currency } from '@/api/currency'
import type { Transaction } from '@/api/transactions'
import { formatCurrency, formatMovedAmount } from '@/utils/formatCurrency'

const CURRENCIES: Currency[] = [
  { id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
]

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies: CURRENCIES,
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, CURRENCIES),
    formatMovedAmount: (amount: number, currency: string) => formatMovedAmount(amount, currency, CURRENCIES),
  }),
}))

import TransactionDateGroupList from '@/components/transactions/DateGroupList'

const MINUS = String.fromCodePoint(0x2212)

function createTransaction(id: string, amount: number): Transaction {
  return {
    id,
    created_by_user_id: 'user-1',
    account_id: 'account-1',
    dt: '2026-06-01',
    merchant_id: null,
    merchant_name: null,
    category_id: 'category-1',
    amount,
    account_amount: amount,
    base_currency_amount: amount,
    currency: 'USD',
    fx_rate: null,
    notes: null,
    counterparty_account_id: null,
    counterparty_account_scope: null,
    created_at: '2026-06-01T12:00:00Z',
    updated_at: '2026-06-01T12:00:00Z',
    tag_ids: [],
    tags: [],
    bank_source: null,
  }
}

type Days = Array<[string, number[]]>

function toDateGroups(days: Days) {
  return days.map(([dateLabel, amounts]) => ({
    dateLabel,
    transactions: amounts.map((amount, index) => createTransaction(`${dateLabel}-${index}`, amount)),
  }))
}

function renderDays(
  days: Days,
  { currency = 'USD', upcoming, inAccount = false }: { currency?: string; upcoming?: Days; inAccount?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <TransactionDateGroupList
      dateGroups={toDateGroups(days)}
      fixedAccount={inAccount ? { id: 'account-1', currency, can_write: true, group_id: null } : undefined}
      upcomingDateGroups={upcoming && toDateGroups(upcoming)}
      today="2026-05-31"
      isUpcomingExpanded
      onToggleUpcoming={() => {}}
      categoryMap={new Map()}
      accountMap={new Map()}
      currency={currency}
      listRevealKey={0}
      stickyTop={0}
      prefersReducedMotion
      onEditTransaction={() => {}}
    />,
  )
}

/** The day total that reads `figure`, as its paragraph's classes and colour */
function dayTotal(markup: string, figure: string): { classes: string[]; color: string } | null {
  const escaped = figure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`<p class="([^"]*)" style="color:([^"]*)">${escaped}</p>`).exec(markup)
  return match && { classes: match[1].split(' '), color: match[2] }
}

describe('transaction list day totals', () => {
  it('signs a day of spending with a true minus and a day of income with a plus', () => {
    // Each day holds two rows, so the day's figure differs from every row's own
    const markup = renderDays([['Spending day', [-5_000, 2_000]], ['Income day', [6_000, 4_000]]])

    expect(markup).toContain(`color:var(--app-negative)">${MINUS}$30.00</p>`)
    expect(markup).toContain('color:var(--app-positive)">+$100.00</p>')
  })

  it('leaves a day that nets to zero unsigned in the neutral colour', () => {
    const markup = renderDays([['Even day', [-5_000, 5_000]]])

    expect(markup).toContain('color:var(--app-text)">$0.00</p>')
  })

  it('writes each total in the financial face, whose numerals are tabular', () => {
    const markup = renderDays([['Spending day', [-150_000]]], { currency: 'CAD' })

    expect(dayTotal(markup, `${MINUS}CA$1,500.00`)?.classes).toContain('font-financial')
  })

  it('signs the days on an account’s own list, which totals in the account’s currency', () => {
    const markup = renderDays([['Spending day', [-150_000]], ['Income day', [12_000]], ['Even day', [-5_000, 5_000]]], {
      currency: 'CAD',
      inAccount: true,
    })

    expect(dayTotal(markup, `${MINUS}CA$1,500.00`)?.color).toBe('var(--app-negative)')
    expect(dayTotal(markup, '+CA$120.00')?.color).toBe('var(--app-positive)')
    expect(dayTotal(markup, 'CA$0.00')?.color).toBe('var(--app-text)')
  })

  it('signs the days in the Upcoming section the same way, in the section’s muted colour', () => {
    const markup = renderDays([], {
      currency: 'CAD',
      upcoming: [['Spending day', [-150_000]], ['Income day', [12_000]], ['Even day', [-5_000, 5_000]]],
    })

    for (const figure of [`${MINUS}CA$1,500.00`, '+CA$120.00', 'CA$0.00']) {
      expect(dayTotal(markup, figure), figure).toEqual({
        classes: expect.arrayContaining(['font-financial']),
        color: 'var(--upcoming-day-total)',
      })
    }
  })
})

describe('transaction list day headings', () => {
  it('describe each row’s button by its own day, in the Upcoming section and the rest alike', () => {
    const markup = renderDays([['June 1, 2026', [-100]], ['May 30, 2026', [200]]], { upcoming: [['June 3, 2026', [300]]] })

    // The second id each title button is described by, after its amount, as the text it points at
    const days = [...markup.matchAll(/<button [^>]*aria-describedby="[^" ]+ ([^"]+)"/g)]
      .map(([, id]) => markup.split(`id="${id}"`)[1]?.match(/^[^>]*>([^<]*)</)?.[1])

    // A title for each of the row's three layouts, the Upcoming day's row first
    expect(days).toEqual(['June 3, 2026', 'June 1, 2026', 'May 30, 2026'].flatMap((day) => [day, day, day]))
  })
})
