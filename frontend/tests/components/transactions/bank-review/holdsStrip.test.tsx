/**
 * Covers the strip of bank holds under the review block: the count it shows closed, and each hold it
 * lists once opened with its merchant and date, as a button that opens its card
 *
 * These tests catch the strip listing rows while closed, a hold shown with an amount or as a review
 * item, a hold offering anything beyond its card, and an account's page naming its own account on every
 * row. Opening the strip, a hold's card and a row leaving run in the browser, since they need effects
 * and clicks
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BankHold } from '@/api/bank-sync/types'
import { BankHoldsStrip } from '@/components/transactions/bank-review/HoldsStrip'
import { textOf } from './fixtures'

// The crossfade needs a browser to mount, so the button's content is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))

const ACCOUNTS: Record<string, { name: string; currency: string }> = {
  everyday: { name: 'Everyday', currency: 'USD' },
}

function createHold(id: string, overrides: Partial<BankHold> = {}): BankHold {
  return {
    id,
    account_id: 'everyday',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    date: '2026-10-03',
    description: `CARD CHECK ${id}`,
    note: `CARD CHECK ${id}`,
    merchant: null,
    observed_at: '2026-10-05T09:00:00Z',
    ...overrides,
  }
}

const HOLDS = [createHold('gas'), createHold('hotel', { date: '2025-12-30' })]

function renderStrip(
  holds: BankHold[],
  { open = false, showAccountNames = true }: Record<string, unknown> = {},
): string {
  return renderToStaticMarkup(
    createElement(BankHoldsStrip, {
      holds,
      accountFor: (accountId: string) => ACCOUNTS[accountId],
      showAccountNames: showAccountNames as boolean,
      today: '2026-10-05',
      open: open as boolean,
      onToggleOpen: () => {},
      onOpenHold: () => {},
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
    expect(textOf(markup)).toContain('Oct 3 · Everyday')
    expect(textOf(markup)).toContain('Dec 30, 2025 · Everyday')
    // The strip's own explanation says $0.00, so only the rows are checked for an amount
    expect(markup.slice(markup.indexOf('<ul'))).not.toMatch(/\$|tabular-nums/)
  })

  it('leaves the account name out on an account page', () => {
    expect(renderStrip(HOLDS, { open: true, showAccountNames: false })).not.toContain('Everyday')
  })

  it('makes each hold a button that opens its card, and nothing else to do', () => {
    for (const showAccountNames of [true, false]) {
      const markup = renderStrip(HOLDS, { open: true, showAccountNames })
      const rowButtons = [...markup.matchAll(/<button[^>]*aria-haspopup="dialog"[^>]*>/g)]

      // The header and one button for each row, and nothing in a row beside its button
      expect(markup.match(/<button/g)).toHaveLength(1 + HOLDS.length)
      expect(rowButtons).toHaveLength(HOLDS.length)
      expect(textOf(markup)).toContain('CARD CHECK hotel')
    }
  })
})
