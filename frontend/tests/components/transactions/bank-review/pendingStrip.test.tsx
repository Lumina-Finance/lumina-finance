/**
 * Covers the strip of pending bank transactions under the review block: the count and explanation
 * it shows closed, each transaction it lists once opened, and how a read that failed is said inside it
 *
 * These tests catch the strip listing rows while closed, losing the explanation on phones, a row
 * that doesn't say how long ago its account was checked so an old hold reads as current, an amount
 * written unsigned or in another account's currency, an account's page naming its own account on
 * every row, a row that can be opened or focused, and a failed read that counts nothing as zero or
 * offers no retry. Opening the strip and the retry's focus run in the browser, since they need effects
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingBankTransaction } from '@/api/bank-sync/types'
import type { BankReadFailure } from '@/components/transactions/bank-review/ReadFailureNotice'
import { formatCurrency, formatMovedAmount } from '@/utils/formatCurrency'
import { createPendingTransaction, MINUS, TEST_CURRENCIES } from './fixtures'

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies: TEST_CURRENCIES,
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, TEST_CURRENCIES),
    formatMovedAmount: (amount: number, currency: string) => formatMovedAmount(amount, currency, TEST_CURRENCIES),
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
  { open = false, showAccountNames = true, failure = null }: { open?: boolean; showAccountNames?: boolean; failure?: BankReadFailure | null } = {},
): string {
  return renderToStaticMarkup(createElement(BankPendingStrip, {
    transactions,
    failure,
    accountFor: (accountId: string) => ACCOUNTS[accountId],
    showAccountNames,
    today: '2026-10-05',
    open,
    onToggleOpen: () => {},
    prefersReducedMotion: true,
  }))
}

/** The markup of the one row holding this text */
function rowWith(markup: string, text: string): string {
  const rows = markup.split('<li').slice(1).filter((row) => row.includes(text))
  expect(rows).toHaveLength(1)
  return rows[0]
}

describe('the closed strip', () => {
  it('counts the pending transactions and says they are outside the balance beside the count from 640px, listing none', () => {
    const markup = renderStrip([UBER, REFUND])

    expect(markup).toContain('aria-label="Pending bank transactions"')
    expect(markup).toMatch(/<button[^>]*aria-expanded="false"/)
    expect(markup).toMatch(/>2 pending<\/span><span class="hidden sm:inline"> · Not in your balance until the bank settles them<\/span>/)
    expect(markup).not.toContain('<li')
  })
})

describe('the opened strip', () => {
  it('lists each transaction with its date, account, that it is pending, when its account was checked, and its signed amount', () => {
    const markup = renderStrip([UBER, REFUND, HOTEL], { open: true })

    expect(markup).toMatch(/<button[^>]*aria-expanded="true"[^>]*aria-controls="[^"]+"/)
    expect(rowWith(markup, 'UBER TRIP')).toMatch(/class="[^"]*italic[^"]*"[^>]*>UBER TRIP</)
    expect(rowWith(markup, 'UBER TRIP')).toContain('Sep 23 · Everyday · Pending · Checked 3 hours ago')
    expect(rowWith(markup, 'UBER TRIP')).toContain(`>${MINUS}$18.00<`)
    expect(rowWith(markup, 'HARBOUR REFUND')).toContain('>+$42.50<')
    expect(rowWith(markup, 'HOTEL HOLD')).toContain('Sep 20 · Visa · Pending · Checked 3 days ago')
  })

  it('says on phones, inside the strip, that they are outside the balance', () => {
    expect(renderStrip([UBER], { open: true })).toMatch(/<p class="[^"]*\bsm:hidden\b[^"]*"[^>]*>Not in your balance until the bank settles them\.<\/p>/)
  })

  it("writes each amount in its own account's currency, and one the currency can't hold exactly as the bank sent it", () => {
    const markup = renderStrip([
      createPendingTransaction('tokyo', 'tokyo', { description: 'TOKYO TAXI', amount: -1800 }),
      createPendingTransaction('amazon', 'everyday', { description: 'AMZN MKTP US', amount: null, raw_amount: '-12.345' }),
    ], { open: true })

    expect(rowWith(markup, 'TOKYO TAXI')).toContain(`>${MINUS}¥1,800<`)
    expect(rowWith(markup, 'AMZN MKTP US')).toContain(`>${MINUS}$12.345<`)
  })

  it("leaves the account's name off each row on its own page", () => {
    expect(renderStrip([UBER], { open: true, showAccountNames: false })).toContain('Sep 23 · Pending · Checked 3 hours ago')
  })

  it('shows rows that open nothing and never take focus', () => {
    const list = renderStrip([UBER, HOTEL], { open: true }).split('<ul>')[1]

    expect(list).not.toMatch(/<button|<a |tabindex|role="button"/)
  })
})

describe('a read that failed', () => {
  const failed = { retry: () => {}, isRetrying: false }

  it('says the pending transactions could not load in place of their count, offering to try again', () => {
    const markup = renderStrip([], { failure: failed })

    expect(markup).toMatch(/role="alert"[^>]*>.*Pending bank transactions could not load\.<\/span><button[^>]*>Try again<\/button>/)
    expect(markup).not.toContain('pending</span>')
    expect(markup).not.toContain('<li')
  })
})
