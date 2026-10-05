/**
 * Covers the comparison a correction or a removal opens from the review block: its title, eyebrow and
 * line for each kind, the rows it compares, which of them it tints and notes, and the two decisions
 * each kind offers
 *
 * These tests catch a removal worded as a correction or the other way round, a removal claiming a
 * bank value it no longer sends, a changed row left untinted or an unchanged one tinted, the note that
 * accepting replaces the user's value missing from an edited field or shown on one the user left
 * alone, an amount the currency can't hold rounded rather than shown as the bank sent it, and the
 * removal's delete offered in anything but the danger colour. Each decision with its toast, a failed
 * decision and the Needs review marker it clears run in the browser, since they need clicks
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { BankReviewItem, BankValues } from '@/api/bank-sync/types'
import { formatCurrency, formatMovedCurrency } from '@/utils/formatCurrency'
import { createReviewItem, MINUS, TEST_CURRENCIES } from './fixtures'

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies: TEST_CURRENCIES,
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, TEST_CURRENCIES),
    formatMovedCurrency: (amount: number, currency: string) => formatMovedCurrency(amount, currency, TEST_CURRENCIES),
  }),
}))
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ showToast: () => {} }) }))

// The real panel renders into a portal, which markup rendered to a string can't hold
vi.mock('@/components/modal/TitledPanel', () => ({
  ModalTitledPanel: ({ title, eyebrow, footer, children }: { title: string; eyebrow: string; footer: ReactNode; children: ReactNode }) => (
    <div><p>{eyebrow}</p><h2>{title}</h2>{children}{footer}</div>
  ),
}))

import { BankComparisonModal } from '@/components/transactions/bank-review/ComparisonModal'

const EDITED_NOTE = 'You edited this. Accepting replaces your value with the bank'

/** Countdown, approved at $42.10 out on Sep 21, which the bank now says was $45.10 */
const LEDGER: BankValues = { date: '2026-09-21', amount: -4210, raw_amount: null, description: 'COUNTDOWN 123 AUCKLAND', merchant_name: null, category_hint: null }
const COUNTDOWN = createReviewItem('countdown', 'correction', 'everyday', {
  current: LEDGER,
  bank: { ...LEDGER, amount: -4510 },
  changed_fields: ['amount'],
})

function render(item: BankReviewItem): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <BankComparisonModal open item={item} currency="USD" onClose={() => {}} />
    </QueryClientProvider>,
  )
}

/** The markup of the table's body for one field, its row and any note under it */
function rowsOf(markup: string, field: string): string {
  const body = markup.split('<tbody').find((part) => part.includes(`data-testid="comparison-${field}"`))
  expect(body).toBeDefined()
  return body?.split('</tbody>')[0] ?? ''
}

function columnHeadings(markup: string): string[] {
  return [...markup.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map(([, heading]) => heading)
}

describe('a correction', () => {
  it('says the bank sent new values, tinting only the row it changed with the bank value in the warning colour', () => {
    const markup = render(COUNTDOWN)

    expect(markup).toContain('<p>Correction from SimpleFIN</p><h2>Review bank change</h2>')
    expect(markup).toContain('SimpleFIN sent new values for a transaction you already approved. Nothing changes unless you accept.')
    expect(columnHeadings(markup)).toEqual(['Field', 'In your ledger', 'From bank'])
    expect([...markup.matchAll(/<th scope="row"[^>]*>([^<]*)<\/th>/g)].map(([, label]) => label)).toEqual(['Date', 'Amount', 'Bank description'])

    const amount = rowsOf(markup, 'amount')
    expect(amount).toContain('background:var(--app-warning-soft)')
    expect(amount).toMatch(new RegExp(`>${MINUS}\\$42\\.10</td><td[^>]*color:var\\(--app-warning-text\\)[^>]*>${MINUS}\\$45\\.10</td>`))
    expect(rowsOf(markup, 'date')).not.toContain('--app-warning')
    expect(rowsOf(markup, 'description')).not.toContain('--app-warning')
    expect(markup).not.toContain(EDITED_NOTE)

    expect(markup).toMatch(/aria-label="Keep current value"[^>]*class="app-secondary-button /)
    expect(markup).toMatch(/aria-label="Accept bank change"[^>]*class="app-primary-button /)
  })

  it('notes under each changed value the user had edited, and only there, that accepting replaces it', () => {
    const markup = render({
      ...COUNTDOWN,
      bank: { ...COUNTDOWN.bank, date: '2026-09-22' },
      changed_fields: ['date', 'amount'],
      protected_fields: ['amount'],
    })

    expect(rowsOf(markup, 'amount')).toContain(EDITED_NOTE)
    expect(rowsOf(markup, 'date')).toContain('background:var(--app-warning-soft)')
    expect(rowsOf(markup, 'date')).not.toContain(EDITED_NOTE)
  })

  it('shows an amount the currency can\'t hold exactly as the bank sent it', () => {
    const markup = render({ ...COUNTDOWN, bank: { ...COUNTDOWN.bank, amount: null, raw_amount: '-45.105' } })

    expect(rowsOf(markup, 'amount')).toContain(`>${MINUS}$45.105</td>`)
  })
})

describe('a removal', () => {
  it('says the bank no longer reports the transaction on every row, offering to remove it in the danger colour', () => {
    const markup = render(createReviewItem('uber', 'removal', 'everyday', {
      current: { ...LEDGER, amount: -1800, description: 'UBER TRIP' },
      bank: { ...LEDGER, amount: -1800, description: 'UBER TRIP' },
    }))

    expect(markup).toContain('<p>Removal from SimpleFIN</p><h2>Review bank removal</h2>')
    expect(markup).toContain('SimpleFIN no longer reports this transaction. It stays in your ledger unless you remove it.')
    expect(columnHeadings(markup)).toEqual(['Field', 'In your ledger', 'Bank'])
    expect(markup.split('>No longer reported</td>')).toHaveLength(4)
    expect(rowsOf(markup, 'amount')).toContain(`>${MINUS}$18.00</td>`)
    expect(markup).not.toContain('--app-warning-soft')

    expect(markup).toMatch(/aria-label="Keep transaction"[^>]*class="app-secondary-button /)
    expect(markup).toMatch(/aria-label="Remove from ledger"[^>]*class="app-danger-button /)
  })
})
