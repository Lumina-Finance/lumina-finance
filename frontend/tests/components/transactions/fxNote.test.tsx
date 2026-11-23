/**
 * Guards the note a row shows under an amount the check refused to convert: a press on its FX badge stays
 * off the row, since a press on the row opens the transaction or toggles its selection, and each row's badge
 * is named by its own row
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { FxNote, TransactionRowView, type TransactionRowMetadata } from '@/components/transactions/Row'

const TRANSACTION: TransactionRowMetadata = {
  id: 'transaction-1',
  dt: '2026-10-04',
  merchant_name: 'Corner Grocer',
  notes: null,
  tags: [],
  counterparty_account_scope: null,
}

describe('the note under a withheld amount', () => {
  it('keeps a press on the badge from reaching the row', () => {
    const note = FxNote({ note: 'unavailable', reason: 'A reason', badgeLabel: 'FX status for a row' })
    const stopPropagation = vi.fn()

    note.props.onClick({ stopPropagation })

    expect(stopPropagation).toHaveBeenCalledOnce()
  })

  it('names each row’s badge by its merchant and amount', () => {
    const markup = renderToStaticMarkup(
      <TransactionRowView
        category={undefined}
        transaction={TRANSACTION}
        amountPresentation={{ text: '−US$120.00', sign: -1 }}
        fxNote="unavailable"
        fxWithheldReason="A reason"
        onOpen={() => {}}
      />,
    )

    expect(markup).toContain('aria-label="FX status for Corner Grocer, −US$120.00"')
  })
})
