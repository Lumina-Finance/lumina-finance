/**
 * Guards the bank marker on a transaction row: a bank-imported row names its provider, adds the edited
 * note and the Needs review marker only when they apply, and uses no nested button inside the row's
 * own button, while a manual row carries no marker at all
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BankMarker } from '@/components/transactions/BankMarker'
import { TransactionRowView, type TransactionRowMetadata } from '@/components/transactions/Row'

const TRANSACTION: TransactionRowMetadata = {
  id: 'transaction-1',
  dt: '2026-10-04',
  merchant_name: 'Corner Grocer',
  notes: null,
  tags: [],
  counterparty_account_scope: null,
}

function renderRow(bankMarker?: Parameters<typeof BankMarker>[0]) {
  return renderToStaticMarkup(
    <TransactionRowView
      category={undefined}
      transaction={TRANSACTION}
      amountPresentation={{ text: '+CA$42.50', sign: 1 }}
      bankMarker={bankMarker}
      onOpen={() => {}}
    />,
  )
}

describe('bank marker', () => {
  it('names the provider on a bank-imported row and nothing more while it is untouched', () => {
    const markup = renderRow({ providerName: 'SimpleFIN', isEdited: false, needsReview: false })

    expect(markup).toContain('aria-label="From SimpleFIN"')
    expect(markup).not.toContain('You edited a value the bank supplied')
    expect(markup).not.toContain('Needs review')
  })

  it('adds the edited note and the Needs review marker when they apply, without nesting a button', () => {
    const markup = renderToStaticMarkup(
      <BankMarker providerName="SimpleFIN" isEdited needsReview onShowReview={() => {}} />,
    )

    expect(markup).toContain('From SimpleFIN. You edited a value the bank supplied')
    expect(markup).toContain('aria-label="Needs review. Show the waiting item"')
    expect(markup).not.toContain('<button')
  })

  it('leaves a manual row without any marker', () => {
    const markup = renderRow()

    expect(markup).toContain('Corner Grocer')
    expect(markup).not.toContain('From SimpleFIN')
  })
})
