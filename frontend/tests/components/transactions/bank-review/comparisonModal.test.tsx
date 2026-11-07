/**
 * Covers the comparison a correction or a removal opens from the review block: its title, eyebrow and
 * line for each kind, the rows it compares, which of them it tints and notes, and the two decisions
 * each kind offers
 *
 * These tests catch a removal worded as a correction or the other way round, a value shown in the
 * wrong column or in a currency other than the account's, a removal claiming a bank value it no longer
 * sends, a changed row left untinted or an unchanged one tinted, the note that accepting replaces the
 * user's value missing from an edited field or shown on one the user left alone, a value the user kept
 * apart from the bank's left reading as a change accepting would make, an amount the
 * currency can't hold rounded rather than shown as the bank sent it, and the removal's delete offered
 * in anything but the danger tone. Each decision with its toast, a failed decision and the Needs
 * review marker it clears run in the browser, since they need clicks
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

// The crossfade needs a browser to mount, so a button's content is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))

// The real panel renders into a portal, and markup rendered to a string can't hold one
vi.mock('@/components/modal/TitledPanel', () => ({
  ModalTitledPanel: ({
    title,
    eyebrow,
    footer,
    children,
  }: {
    title: string
    eyebrow: string
    footer: ReactNode
    children: ReactNode
  }) => (
    <div>
      <p>{eyebrow}</p>
      <h2>{title}</h2>
      {children}
      {footer}
    </div>
  ),
}))

import { BankComparisonModal } from '@/components/transactions/bank-review/ComparisonModal'

const EDITED_NOTE = "You edited this. Accepting replaces your value with the bank's."
const KEPT_NOTE = 'Your own value. Accepting leaves it as it is.'
const FIELDS = ['date', 'amount', 'description'] as const
const TINT = 'var(--app-warning-soft)'

/** Countdown, approved at $42.10 out on Sep 21, and the bank now says it was $45.10 */
const LEDGER: BankValues = {
  date: '2026-09-21',
  amount: -4210,
  raw_amount: null,
  description: 'COUNTDOWN 123 AUCKLAND',
}
const COUNTDOWN = createReviewItem('countdown', 'correction', 'everyday', {
  current: LEDGER,
  bank: { ...LEDGER, amount: -4510 },
  changed_fields: ['amount'],
})

function render(item: BankReviewItem, currency = 'USD'): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <BankComparisonModal open item={item} currency={currency} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

/** A tag's style attribute read into its properties, so a check doesn't depend on how React writes it */
function styleOf(tag: string): Record<string, string> {
  const style = /\sstyle="([^"]*)"/.exec(tag)?.[1] ?? ''
  return Object.fromEntries(
    style
      .split(';')
      .filter(Boolean)
      .map((rule) => {
        const at = rule.indexOf(':')
        return [rule.slice(0, at).trim(), rule.slice(at + 1).trim()]
      }),
  )
}

/** One field's body of the table: its tint, its label, ledger and bank cells, and the text of any note under them */
function rowOf(markup: string, field: string) {
  const body = new RegExp(`(<tbody\\b[^>]*\\sdata-testid="comparison-${field}"[^>]*>)([\\s\\S]*?)</tbody>`).exec(markup)
  expect(body).not.toBeNull()
  const [, opening = '', content = ''] = body ?? []
  const [row = '', note] = content.split('</tr>').filter((part) => part.includes('<td'))
  const cells = [...row.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map(([, , attributes = '', text = '']) => ({
    text: textOf(text),
    color: styleOf(attributes).color,
  }))
  return { tint: styleOf(opening).background, cells, note: note === undefined ? undefined : textOf(note) }
}

function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, '')
    .replaceAll('&#x27;', "'")
    .trim()
}

/** The tone of the button named `label`, read from its class whatever order its attributes come in */
function toneOf(markup: string, label: string): string | undefined {
  const tag = new RegExp(`<button\\b[^>]*\\saria-label="${label}"[^>]*>`).exec(markup)?.[0] ?? ''
  return /\sclass="([^"]*)"/
    .exec(tag)?.[1]
    ?.split(/\s+/)
    .map((name) => /^app-(\w+)-button$/.exec(name)?.[1])
    .find(Boolean)
}

function columnHeadings(markup: string): string[] {
  return [...markup.matchAll(/<th\b[^>]*\sscope="col"[^>]*>([^<]*)<\/th>/g)].map(([, heading = '']) => heading)
}

describe('a correction', () => {
  it("compares each value in its column and the account's currency, tinting the rows the bank changed with its value in the warning colour", () => {
    const markup = render(
      createReviewItem('countdown', 'correction', 'everyday', {
        current: LEDGER,
        bank: { ...LEDGER, amount: -4510, description: 'COUNTDOWN AUCKLAND CENTRAL' },
        changed_fields: ['amount', 'description'],
      }),
      'JPY',
    )

    expect(markup).toContain('<p>Correction from SimpleFIN</p><h2>Review bank change</h2>')
    expect(markup).toContain(
      'SimpleFIN sent new values for a transaction you already approved. Nothing changes unless you accept.',
    )
    expect(columnHeadings(markup)).toEqual(['Field', 'In your ledger', 'From bank'])
    expect([...markup.matchAll(/data-testid="comparison-(\w+)"/g)].map(([, field]) => field)).toEqual([...FIELDS])

    const rows = FIELDS.map((field) => rowOf(markup, field))
    expect(rows.map(({ cells }) => cells.map(({ text }) => text))).toEqual([
      ['Date', 'Sep 21, 2026', 'Sep 21, 2026'],
      ['Amount', `${MINUS}¥4,210`, `${MINUS}¥4,510`],
      ['Bank description', 'COUNTDOWN 123 AUCKLAND', 'COUNTDOWN AUCKLAND CENTRAL'],
    ])
    expect(rows.map(({ tint }) => tint)).toEqual([undefined, TINT, TINT])
    expect(rows.map(({ cells }) => cells[2]?.color)).toEqual([
      'var(--app-text)',
      'var(--app-warning-text)',
      'var(--app-warning-text)',
    ])
    expect(rows.map(({ note }) => note)).toEqual([undefined, undefined, undefined])

    expect(toneOf(markup, 'Keep current value')).toBe('secondary')
    expect(toneOf(markup, 'Accept bank change')).toBe('primary')
  })

  it('notes under each changed value the user had edited, and only there, that accepting replaces it', () => {
    const markup = render({
      ...COUNTDOWN,
      bank: { ...COUNTDOWN.bank, date: '2026-09-22' },
      changed_fields: ['date', 'amount'],
      protected_fields: ['amount'],
    })

    expect(rowOf(markup, 'amount').note).toBe(EDITED_NOTE)
    expect(rowOf(markup, 'date')).toMatchObject({ tint: TINT, note: undefined })
  })

  it("notes under a value the user kept apart from the bank's, which the change doesn't touch, that accepting leaves it", () => {
    const markup = render({
      ...COUNTDOWN,
      bank: { ...COUNTDOWN.bank, date: '2026-09-22' },
      changed_fields: ['date'],
    })

    expect(rowOf(markup, 'amount')).toMatchObject({ tint: undefined, note: KEPT_NOTE })
    expect(rowOf(markup, 'amount').cells.map(({ text }) => text)).toEqual([
      'Amount',
      `${MINUS}$42.10`,
      `${MINUS}$45.10`,
    ])
    expect(rowOf(markup, 'date').note).toBeUndefined()
    expect(rowOf(markup, 'description').note).toBeUndefined()
  })

  it("shows an amount the currency can't hold exactly as the bank sent it", () => {
    const markup = render({ ...COUNTDOWN, bank: { ...COUNTDOWN.bank, amount: null, raw_amount: '-45.105' } })

    expect(rowOf(markup, 'amount').cells[2]?.text).toBe(`${MINUS}$45.105`)
  })
})

describe('a removal', () => {
  it('says the bank no longer reports the transaction on every row, offering to remove it in the danger tone', () => {
    const markup = render(
      createReviewItem('uber', 'removal', 'everyday', {
        current: { ...LEDGER, amount: -1800, description: 'UBER TRIP' },
        // Last reported at an amount the user changed, and a removal still doesn't offer to keep it apart
        bank: { ...LEDGER, amount: -1750, description: 'UBER TRIP' },
      }),
    )

    expect(markup).toContain('<p>Removal from SimpleFIN</p><h2>Review bank removal</h2>')
    expect(markup).toContain(
      'SimpleFIN no longer reports this transaction. It stays in your ledger unless you remove it.',
    )
    expect(columnHeadings(markup)).toEqual(['Field', 'In your ledger', 'Bank'])

    const rows = FIELDS.map((field) => rowOf(markup, field))
    expect(rows.map(({ cells }) => cells.slice(1).map(({ text }) => text))).toEqual([
      ['Sep 21, 2026', 'No longer reported'],
      [`${MINUS}$18.00`, 'No longer reported'],
      ['UBER TRIP', 'No longer reported'],
    ])
    expect(rows.map(({ tint }) => tint)).toEqual([undefined, undefined, undefined])
    expect(rows.map(({ note }) => note)).toEqual([undefined, undefined, undefined])

    expect(toneOf(markup, 'Keep transaction')).toBe('secondary')
    expect(toneOf(markup, 'Remove from ledger')).toBe('danger')
  })
})
