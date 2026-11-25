/**
 * Guards a transaction row's tab stops. A row offers one stop: its title out of selection mode, its
 * checkbox in it. A read-only row's reason pill takes none, so a faded row, archived or kept read-only,
 * offers no more stops than any other, and a read-only row's held-back checkbox leaves it none in
 * selection mode, as an archived row's always has
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Currency } from '@/api/currency'
import type { Transaction } from '@/api/transactions/types'
import type { TransactionRowSelection } from '@/components/transactions/Row'
import { formatCurrency, formatMovedCurrency } from '@/utils/formatCurrency'
import { isDrawn } from '@tests/utils/readMarkup'

const CURRENCIES: Currency[] = [{ id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 }]

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies: CURRENCIES,
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, CURRENCIES),
    formatMovedCurrency: (amount: number, currency: string) => formatMovedCurrency(amount, currency, CURRENCIES),
  }),
}))
// The checkbox's entry needs a browser to animate, so it is drawn as it rests
vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>()
  return { ...actual, AnimatePresence: ({ children }: { children: unknown }) => children }
})

import TransactionRow from '@/components/transactions/Row'

const TRANSACTION: Transaction = {
  id: 'transaction-1',
  created_by_user_id: 'user-1',
  account_id: 'account-1',
  dt: '2026-10-04',
  merchant_id: null,
  merchant_name: 'Uber',
  category_id: 'category-1',
  amount: -1800,
  account_amount: -1800,
  base_currency_amount: -1800,
  currency: 'USD',
  fx_rate: null,
  notes: null,
  counterparty_account_id: null,
  counterparty_account_scope: null,
  created_at: '2026-10-04T12:00:00Z',
  updated_at: '2026-10-04T12:00:00Z',
  tag_ids: [],
  tags: [],
  refund_of_transaction_id: null,
  refund_transaction_ids: [],
  bank_source: null,
}

const ROWS = [
  ['a row that takes writes', undefined],
  ['an archived row', 'Archived · Read-only'],
  ['a read-only row', 'Records in USD are read-only. They can be archived or deleted'],
] as const

function selection(isSelectable: boolean): TransactionRowSelection {
  return { mark: 'none', isSelectable, limitReason: '', onToggle: () => {}, onPointerEnter: () => {} }
}

function render(readOnlyReason: string | undefined, inSelection: boolean): string {
  return renderToStaticMarkup(
    <TransactionRow
      category={undefined}
      currency="USD"
      transaction={TRANSACTION}
      accountName="Chase Sapphire"
      readOnlyReason={readOnlyReason}
      hidesReadOnlyReason={readOnlyReason !== undefined}
      selection={inSelection ? selection(readOnlyReason === undefined) : undefined}
      dateHeadingId="day-heading"
      onOpen={() => {}}
    />,
  )
}

const thresholdOf = (variant: string) => Number(variant.match(/^min-\[(\d+)px\]$/)?.[1] ?? NaN) || null

/** The elements Tab stops on at a width, read from the markup with the layout's classes standing in for CSS */
function tabStops(markup: string, width: number): string[] {
  const stops: string[] = []
  const drawn: boolean[] = [true]
  for (const [, closing, tag, attributes] of markup.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g)) {
    if (closing) {
      drawn.pop()
      continue
    }
    const isShown = drawn[drawn.length - 1] && isDrawn(attributes, width, thresholdOf)
    const tabIndex = attributes.match(/\stabindex="(-?\d+)"/)?.[1]
    const isNative =
      ['button', 'input', 'select', 'textarea'].includes(tag) || (tag === 'a' && attributes.includes(' href='))
    const takesTab = tabIndex === undefined ? isNative && !attributes.includes(' disabled=""') : Number(tabIndex) >= 0
    if (isShown && takesTab) stops.push(attributes.match(/\saria-label="([^"]*)"/)?.[1] ?? tag)
    if (
      !['input', 'img', 'br', 'hr', 'path', 'circle', 'line', 'rect', 'polyline'].includes(tag) &&
      !attributes.endsWith('/')
    )
      drawn.push(isShown)
  }
  return stops
}

describe('the tab stops of a transaction row', () => {
  it.each(ROWS)('gives %s one stop, its title, at each width', (_, reason) => {
    for (const width of [400, 1000]) {
      expect(tabStops(render(reason, false), width)).toEqual(['button'])
    }
  })

  it('gives a row that takes writes one stop in selection mode, its checkbox', () => {
    for (const width of [400, 1000]) {
      expect(tabStops(render(undefined, true), width)).toEqual(['Select Uber on 2026-10-04'])
    }
  })

  it.each(ROWS.slice(1))('gives %s no stop in selection mode, its checkbox held back', (_, reason) => {
    for (const width of [400, 1000]) {
      expect(tabStops(render(reason, true), width)).toEqual([])
    }
  })

  it('still draws the read-only pill, out of the tab order', () => {
    const markup = render(ROWS[2][1], false)

    expect(markup).toContain('data-testid="read-only-reason-pill"')
    expect(markup).not.toMatch(/data-testid="read-only-reason-pill" tabindex/)
  })
})
