/**
 * Guards the bank marker a transaction row builds from the bank source it carries: the provider it
 * names, the edited note when a bank value was changed, and the Needs review marker for a waiting
 * correction or removal only where the list can go to its item. Also guards why a row past the
 * shared tick cap can't be ticked, in the wording its list gives
 *
 * These tests catch the marker missing from a row whose source names a waiting item, showing on a
 * row with nothing waiting, showing where nothing could follow it, such as the import preview, a
 * row with an edited bank value not saying so, and a row past the cap naming only transactions
 * while review items share the cap. That pressing the marker goes to its item runs in the
 * browser, since it needs a click
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { TransactionBankSource } from '@/api/bank-sync/types'
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

const NEEDS_REVIEW = 'aria-label="Needs review. Show the waiting item"'

const SOURCE: TransactionBankSource = {
  provider: 'simplefin',
  provider_name: 'SimpleFIN',
  bank_values: { date: '2026-10-04', amount: -1800, raw_amount: null, description: 'UBER TRIP' },
  received_at: '2026-10-04T09:05:00Z',
  edited_fields: [],
  review_item_id: null,
}

function createTransaction(source: TransactionBankSource | null): Transaction {
  return {
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
    bank_source: source,
  }
}

function renderRow(source: TransactionBankSource | null, onShowReview?: (reviewItemId: string) => void): string {
  return renderToStaticMarkup(
    <TransactionRow
      category={undefined}
      currency="USD"
      transaction={createTransaction(source)}
      onShowReview={onShowReview}
      onOpen={() => {}}
    />,
  )
}

describe('the bank marker a row builds', () => {
  it('shows Needs review on a row whose waiting item the list can go to', () => {
    expect(renderRow({ ...SOURCE, review_item_id: 'item-60' }, () => {})).toContain(NEEDS_REVIEW)
  })

  it('leaves Needs review out where nothing waits, or where the list has no block to go to', () => {
    const untouched = renderRow(SOURCE, () => {})

    const withoutBlock = renderRow({ ...SOURCE, review_item_id: 'item-60' })

    expect(untouched).toContain('aria-label="From SimpleFIN"')
    expect(untouched).not.toContain(NEEDS_REVIEW)
    expect(withoutBlock).toContain('aria-label="From SimpleFIN"')
    expect(withoutBlock).not.toContain(NEEDS_REVIEW)
  })

  it('says a bank value was edited once one of them is', () => {
    expect(renderRow({ ...SOURCE, edited_fields: ['amount'] }, () => {})).toContain(
      'aria-label="From SimpleFIN, edited"',
    )
  })

  it('names no provider on a row entered by hand', () => {
    expect(renderRow(null, () => {})).not.toContain('From SimpleFIN')
  })
})

describe('the tick on a row past the cap', () => {
  it('says why in the wording its list gives, so it matches the review rows beside it', () => {
    const limitReason = 'Up to 1000 transactions and review items can be ticked at once'
    const markup = renderToStaticMarkup(
      <TransactionRow
        category={undefined}
        currency="USD"
        transaction={createTransaction(null)}
        onOpen={() => {}}
        selection={{ mark: 'none', isSelectable: false, limitReason, onToggle: () => {}, onPointerEnter: () => {} }}
      />,
    )

    expect(markup).toContain(`title="${limitReason}"`)
  })
})
