/**
 * Guards what a read-only transaction row's pill shows. The row's own short reasons, such as
 * "Archived · Read-only", show whole in the pill, as they did before the account's own sentence came in.
 * The account's sentence is too long for the pill, so the pill reads "Read-only" and keeps the sentence for
 * its tooltip and a screen reader
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

const SENTENCE = 'Your account keeps records in other currencies read-only'

function pillTexts(readOnlyReason: string, hidesReadOnlyReason?: boolean): string[] {
  const markup = renderToStaticMarkup(
    <TransactionRow
      category={undefined}
      currency="USD"
      transaction={TRANSACTION}
      accountName="Everyday Chequing"
      readOnlyReason={readOnlyReason}
      hidesReadOnlyReason={hidesReadOnlyReason}
      dateHeadingId="day-heading"
      onOpen={() => {}}
    />,
  )
  const starts = [...markup.matchAll(/<span\b[^>]*data-testid="read-only-reason-pill"[^>]*>/g)]
  return starts.map((start) => textOfSpan(markup, (start.index ?? 0) + start[0].length))
}

// The text inside a span whose opening tag ends at `from`, up to the tag closing it
function textOfSpan(markup: string, from: number): string {
  let depth = 1
  let text = ''
  for (const part of markup.slice(from).split(/(<[^>]+>)/)) {
    if (part.startsWith('</span')) depth -= 1
    else if (part.startsWith('<span')) depth += 1
    else if (!part.startsWith('<')) text += part
    if (depth === 0) break
  }
  return text.replaceAll('&#x27;', "'")
}

describe('what a read-only transaction row pill shows', () => {
  it('shows the row’s own short reason whole, with nothing else', () => {
    const texts = pillTexts('Archived · Read-only')

    expect(texts.length).toBeGreaterThan(0)
    for (const text of texts) expect(text).toBe('Archived · Read-only')
  })

  it('shows Read-only for the account’s sentence and keeps the sentence for a screen reader', () => {
    const texts = pillTexts(SENTENCE, true)

    expect(texts.length).toBeGreaterThan(0)
    for (const text of texts) expect(text).toBe(`Read-only. ${SENTENCE}`)
  })
})
