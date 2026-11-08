/**
 * Guards what a focused transaction row reads. Its title button is the row's one control, so it is
 * described by the category, the account and the amount beside it, in the order its layout shows
 * them, then by the day's heading. It was described by the amount and the heading only, so a
 * screen reader lost the category and the account
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Currency } from '@/api/currency'
import type { Transaction } from '@/api/transactions/types'
import { formatCurrency, formatMovedCurrency } from '@/utils/formatCurrency'

const CURRENCIES: Currency[] = [{ id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 }]

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies: CURRENCIES,
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, CURRENCIES),
    formatMovedCurrency: (amount: number, currency: string) => formatMovedCurrency(amount, currency, CURRENCIES),
  }),
}))

import TransactionRow from '@/components/transactions/Row'

// The app writes a negative amount with a true minus sign
const AMOUNT = '−$18.00'

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

function render(
  options: {
    phoneLayout?: boolean
    accountName?: string
    fxNote?: 'unavailable' | 'rateNotPublished'
    readOnlyReason?: string
    transaction?: Partial<Transaction>
  } = {},
): string {
  return renderToStaticMarkup(
    <TransactionRow
      category={undefined}
      currency="USD"
      transaction={{ ...TRANSACTION, ...options.transaction }}
      accountName={options.accountName}
      fxNote={options.fxNote}
      readOnlyReason={options.readOnlyReason}
      phoneLayout={options.phoneLayout}
      dateHeadingId="day-heading"
      onOpen={() => {}}
    />,
  )
}

/**
 * What each id in a title's description names, as a screen reader reads it: the element's own label
 * where it has one, else its text with React's text markers taken out
 */
function describedTexts(markup: string): string[][] {
  const titles = [...markup.matchAll(/<button\b[^>]*data-row-title[^>]*>/g)]
  return titles.map((title) => {
    const ids = title[0].match(/aria-describedby="([^"]*)"/)?.[1].split(' ') ?? []
    return ids.map((id) => {
      if (id === 'day-heading') return id
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const element = markup.match(new RegExp(`<span\\b([^>]*\\bid="${escaped}"[^>]*)>(.*?)</span>`))
      if (!element) return `missing ${id}`
      // A block inside the element, such as the note under an amount, reads apart from the text before it
      const text = element[2]
        .replaceAll('<!-- -->', '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      return element[1].match(/aria-label="([^"]*)"/)?.[1] ?? text
    })
  })
}

describe('what a transaction row title is described by', () => {
  it('reads the category, the account and the amount on the wide layout, and the amount, category and account on the phone layout', () => {
    const [wide, narrow] = describedTexts(render({ accountName: 'Everyday Chequing' }))

    expect(wide).toEqual(['Uncategorized', 'Everyday Chequing', AMOUNT, 'day-heading'])
    expect(narrow).toEqual([AMOUNT, 'Uncategorized', 'Everyday Chequing', 'day-heading'])
  })

  it('describes the one title of a row held to the phone layout the same way', () => {
    expect(describedTexts(render({ phoneLayout: true, accountName: 'Everyday Chequing' }))).toEqual([
      [AMOUNT, 'Uncategorized', 'Everyday Chequing', 'day-heading'],
    ])
  })

  it('names no account for a row without one', () => {
    const [wide, narrow] = describedTexts(render({}))

    expect(wide).toEqual(['Uncategorized', AMOUNT, 'day-heading'])
    expect(narrow).toEqual([AMOUNT, 'Uncategorized', 'day-heading'])
  })

  it('reads the exchange rate note after the amount in both layouts', () => {
    const [wide, narrow] = describedTexts(render({ accountName: 'Everyday Chequing', fxNote: 'unavailable' }))

    expect(wide).toEqual(['Uncategorized', 'Everyday Chequing', `${AMOUNT} FX unavailable`, 'day-heading'])
    expect(narrow).toEqual([AMOUNT, 'FX unavailable', 'Uncategorized', 'Everyday Chequing', 'day-heading'])
  })

  it('reads the read-only pill after the account in both layouts', () => {
    const [wide, narrow] = describedTexts(
      render({ accountName: 'Everyday Chequing', readOnlyReason: 'Account archived' }),
    )

    expect(wide).toEqual(['Uncategorized', 'Everyday Chequing', 'Account archived', AMOUNT, 'day-heading'])
    expect(narrow).toEqual([AMOUNT, 'Uncategorized', 'Everyday Chequing', 'Account archived', 'day-heading'])
  })

  it('reads the refund link label in the place each layout shows it', () => {
    const [wide, narrow] = describedTexts(
      render({ accountName: 'Everyday Chequing', transaction: { refund_transaction_ids: ['refund-1'] } }),
    )

    expect(wide).toEqual(['Uncategorized', 'Everyday Chequing', 'Refunded once', AMOUNT, 'day-heading'])
    expect(narrow).toEqual([AMOUNT, 'Uncategorized', 'Everyday Chequing', 'Refunded once', 'day-heading'])
  })

  it('says a row has a note', () => {
    const [wide, narrow] = describedTexts(
      render({ accountName: 'Everyday Chequing', transaction: { notes: 'Airport run' } }),
    )

    expect(wide).toEqual(['Uncategorized', 'Everyday Chequing', 'Has note', AMOUNT, 'day-heading'])
    expect(narrow).toEqual([AMOUNT, 'Uncategorized', 'Everyday Chequing', 'Has note', 'day-heading'])
  })

  it('says how many tags a row has, in the singular and the plural', () => {
    const tag = (id: string) => ({ id, group_id: null, name: `Tag ${id}` })
    const one = describedTexts(render({ transaction: { tags: [tag('a')] } }))
    const two = describedTexts(render({ transaction: { tags: [tag('a'), tag('b')] } }))

    expect(one).toEqual([
      ['Uncategorized', '1 tag', AMOUNT, 'day-heading'],
      [AMOUNT, 'Uncategorized', '1 tag', 'day-heading'],
    ])
    expect(two).toEqual([
      ['Uncategorized', '2 tags', AMOUNT, 'day-heading'],
      [AMOUNT, 'Uncategorized', '2 tags', 'day-heading'],
    ])
  })

  it('reads the refund link, the note and the tags in the order the phone layout draws them', () => {
    const [, narrow] = describedTexts(
      render({
        transaction: {
          refund_of_transaction_id: 'expense-1',
          notes: 'Airport run',
          tags: [{ id: 'a', group_id: null, name: 'Travel' }],
        },
      }),
    )

    expect(narrow).toEqual([AMOUNT, 'Uncategorized', 'Refund of an expense', 'Has note', '1 tag', 'day-heading'])
  })

  it('leaves out a read-only pill the phone layout does not draw for a row with no account or extras', () => {
    const [, narrow] = describedTexts(render({ readOnlyReason: 'Account archived' }))

    expect(narrow).toEqual([AMOUNT, 'Uncategorized', 'day-heading'])
  })
})
