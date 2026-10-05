/**
 * Guards the Needs review marker a transaction row builds from the bank source it carries: shown for
 * a waiting correction or removal only where the list can go to its item, and going to that item
 *
 * These tests catch the marker missing from a row whose source names a waiting item, showing on a
 * row with nothing waiting, or showing where nothing could follow it, such as the import preview
 */
import type { ReactElement } from 'react'
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

import TransactionRow, { TransactionRowView } from '@/components/transactions/Row'

const SOURCE: TransactionBankSource = {
  provider: 'simplefin',
  provider_name: 'SimpleFIN',
  bank_values: { date: '2026-10-04', amount: -1800, raw_amount: null, description: 'UBER TRIP', merchant_name: null, category_hint: null },
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

/** The props the row hands its view, read off the element it renders rather than its markup */
function viewProps(source: TransactionBankSource | null, onShowReview?: (reviewItemId: string) => void) {
  const element = TransactionRow({
    category: undefined,
    currency: 'USD',
    transaction: createTransaction(source),
    onShowReview,
    onOpen: () => {},
  }) as ReactElement<Parameters<typeof TransactionRowView>[0]>
  return element.props
}

describe('the Needs review marker', () => {
  it('shows on a row whose waiting item the list can go to, and goes to that item', () => {
    const onShowReview = vi.fn()
    const { bankMarker } = viewProps({ ...SOURCE, review_item_id: 'item-60' }, onShowReview)

    expect(bankMarker?.needsReview).toBe(true)
    bankMarker?.onShowReview?.()
    expect(onShowReview).toHaveBeenCalledWith('item-60')
  })

  it('is left out where nothing waits, or where the list has no block to go to', () => {
    expect(viewProps(SOURCE, vi.fn()).bankMarker).toMatchObject({ providerName: 'SimpleFIN', needsReview: false })
    expect(viewProps({ ...SOURCE, review_item_id: 'item-60' }).bankMarker?.needsReview).toBe(false)
    expect(viewProps(null, vi.fn()).bankMarker).toBeUndefined()
  })

  it('reads as a button that goes to the waiting item', () => {
    const markup = renderToStaticMarkup(<TransactionRowView {...viewProps({ ...SOURCE, review_item_id: 'item-60' }, () => {})} />)

    expect(markup).toContain('aria-label="Needs review. Show the waiting item"')
  })
})
