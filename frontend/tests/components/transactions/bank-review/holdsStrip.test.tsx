/**
 * Covers the strip of bank holds under the review block: the count it shows closed, and each hold it
 * lists once opened with its merchant, date and a two-press Dismiss
 *
 * These tests catch the strip listing rows while closed, a hold shown with an amount or as a review
 * item, a Dismiss that runs on one press, an account's page naming its own account on every row, and a
 * hold being dismissed whose button doesn't show it. Opening the strip, the two presses and a row
 * leaving run in the browser, since they need effects and clicks
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BankHold } from '@/api/bank-sync/types'
import { BankHoldsStrip } from '@/components/transactions/bank-review/HoldsStrip'

const ACCOUNTS: Record<string, { name: string; currency: string }> = {
  everyday: { name: 'Everyday', currency: 'USD' },
}

function createHold(id: string, overrides: Partial<BankHold> = {}): BankHold {
  return {
    id,
    account_id: 'everyday',
    date: '2026-10-03',
    description: `CARD CHECK ${id}`,
    observed_at: '2026-10-05T09:00:00Z',
    ...overrides,
  }
}

const HOLDS = [createHold('gas'), createHold('hotel', { date: '2025-12-30' })]

function renderStrip(
  holds: BankHold[],
  { open = false, showAccountNames = true, dismissingId = null }: Record<string, unknown> = {},
): string {
  return renderToStaticMarkup(
    createElement(BankHoldsStrip, {
      holds,
      accountFor: (accountId: string) => ACCOUNTS[accountId],
      showAccountNames: showAccountNames as boolean,
      today: '2026-10-05',
      open: open as boolean,
      onToggleOpen: () => {},
      dismissingId: dismissingId as string | null,
      onDismiss: () => {},
      prefersReducedMotion: true,
    }),
  )
}

describe('the holds strip', () => {
  it('counts the holds and lists none while closed', () => {
    const markup = renderStrip(HOLDS)

    expect(markup).toContain('2 holds')
    expect(markup).toMatch(/aria-expanded="false"/)
    expect(markup).not.toContain('CARD CHECK')
  })

  it('says one hold in the singular', () => {
    expect(renderStrip([HOLDS[0]])).toContain('1 hold<')
  })

  it('lists each hold with its merchant, date and account once opened, and no amount', () => {
    const markup = renderStrip(HOLDS, { open: true })

    expect(markup).toContain('CARD CHECK gas')
    expect(markup).toContain('Oct 3 · Everyday')
    expect(markup).toMatch(/Dec 30, 2025 · Everyday/)
    expect(markup).not.toMatch(/\$|tabular-nums/)
  })

  it('leaves the account name out on an account page', () => {
    expect(renderStrip(HOLDS, { open: true, showAccountNames: false })).not.toContain('Everyday')
  })

  it('gives each hold a Dismiss that asks again before it runs, drawn as Delete is', () => {
    const markup = renderStrip(HOLDS, { open: true })

    expect(markup.match(/data-testid="bank-hold-dismiss"/g)).toHaveLength(2)
    expect(markup).toContain('app-danger-button')
    expect(markup).toMatch(/opacity:0[^>]*>Yes, dismiss<\/span>/)
  })

  it('shows a spinner on the hold being dismissed and holds the others', () => {
    const markup = renderStrip(HOLDS, { open: true, dismissingId: 'gas' })
    const buttons = markup.split('data-testid="bank-hold-dismiss"').slice(1)

    expect(buttons[0]).toContain('app-spinner')
    expect(buttons[1]).toContain('disabled=""')
  })
})
