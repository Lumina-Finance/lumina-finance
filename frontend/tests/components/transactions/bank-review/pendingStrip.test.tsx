/**
 * Covers the strip of pending bank transactions under the review block: the count and explanation
 * it shows closed, and each transaction it lists once opened
 *
 * These tests catch the strip listing rows while closed, losing its explanation once opened, a row
 * that doesn't say how long ago its account was checked so an old hold reads as current, an amount
 * written unsigned or in another account's currency, and an account's page naming its own account on
 * every row. A failed read is covered with the section, and opening the strip, the retry's focus and
 * a row that opens nothing run in the browser, since they need effects
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingBankTransaction } from '@/api/bank-sync/types'
import { formatCurrency, formatMovedCurrency } from '@/utils/formatCurrency'
import { createPendingTransaction, MINUS, TEST_CURRENCIES, textOf } from './fixtures'

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies: TEST_CURRENCIES,
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, TEST_CURRENCIES),
    formatMovedCurrency: (amount: number, currency: string) => formatMovedCurrency(amount, currency, TEST_CURRENCIES),
  }),
}))

import { BankPendingStrip } from '@/components/transactions/bank-review/PendingStrip'

const ACCOUNTS: Record<string, { name: string; currency: string }> = {
  everyday: { name: 'Everyday', currency: 'USD' },
  visa: { name: 'Visa', currency: 'USD' },
  tokyo: { name: 'Tokyo', currency: 'JPY' },
}

// Everyday synced three hours ago, and Visa three days ago, before its bank sign-in needed attention
const UBER = createPendingTransaction('uber', 'everyday', { description: 'UBER TRIP' })
const REFUND = createPendingTransaction('refund', 'everyday', { description: 'HARBOUR REFUND', amount: 4250 })
const HOTEL = createPendingTransaction('hotel', 'visa', {
  date: '2026-09-20',
  description: 'HOTEL HOLD',
  amount: -24000,
  observed_at: '2026-10-02T12:00:00Z',
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

function renderStrip(
  transactions: PendingBankTransaction[],
  { open = false, showAccountNames = true }: { open?: boolean; showAccountNames?: boolean } = {},
): string {
  return renderToStaticMarkup(
    createElement(BankPendingStrip, {
      transactions,
      failure: null,
      accountFor: (accountId: string) => ACCOUNTS[accountId],
      showAccountNames,
      today: '2026-10-05',
      open,
      onToggleOpen: () => {},
      prefersReducedMotion: true,
    }),
  )
}

/** The markup of the one row holding this text */
function rowWith(markup: string, text: string): string {
  const rows = markup
    .split('<li')
    .slice(1)
    .filter((row) => row.includes(text))
  expect(rows).toHaveLength(1)
  return rows[0]
}

describe('the closed strip', () => {
  it('counts the pending transactions and says they are outside the balance, listing none', () => {
    const markup = renderStrip([UBER, REFUND])

    expect(markup).toContain('aria-label="Pending bank transactions"')
    expect(markup).toMatch(/<button[^>]*aria-expanded="false"/)
    expect(markup).toContain('>2 pending<')
    expect(markup).toContain('> · Not counted until the bank posts them<')
    expect(markup).not.toContain('<li')
  })
})

describe('the opened strip', () => {
  it('lists each transaction with its date, account, that it is pending, when its account was checked, and its signed amount', () => {
    const markup = renderStrip([UBER, REFUND, HOTEL], { open: true })

    expect(markup).toMatch(/<button[^>]*aria-expanded="true"[^>]*aria-controls="[^"]+"/)
    expect(textOf(rowWith(markup, 'UBER TRIP'))).toContain('Sep 23 · Everyday · Pending · Checked 3 hours ago')
    expect(rowWith(markup, 'UBER TRIP')).toContain(`>${MINUS}$18.00<`)
    expect(rowWith(markup, 'HARBOUR REFUND')).toContain('>+$42.50<')
    expect(textOf(rowWith(markup, 'HOTEL HOLD'))).toContain('Sep 20 · Visa · Pending · Checked 3 days ago')
  })

  it('says inside the strip that they are outside the balance', () => {
    expect(renderStrip([UBER], { open: true })).toContain('>Not counted until the bank posts them.<')
  })

  it("writes each amount in its own account's currency, and one the currency can't hold exactly as the bank sent it", () => {
    const markup = renderStrip(
      [
        createPendingTransaction('tokyo', 'tokyo', { description: 'TOKYO TAXI', amount: -1800 }),
        createPendingTransaction('amazon', 'everyday', {
          description: 'AMZN MKTP US',
          amount: null,
          raw_amount: '-12.345',
        }),
      ],
      { open: true },
    )

    expect(rowWith(markup, 'TOKYO TAXI')).toContain(`>${MINUS}¥1,800<`)
    expect(rowWith(markup, 'AMZN MKTP US')).toContain(`>${MINUS}$12.345<`)
  })

  it("leaves the account's name off each row on its own page", () => {
    expect(textOf(renderStrip([UBER], { open: true, showAccountNames: false }))).toContain(
      'Sep 23 · Pending · Checked 3 hours ago',
    )
  })
})
