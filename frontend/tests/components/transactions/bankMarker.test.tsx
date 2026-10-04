/**
 * Guards the bank marker on a transaction row: a bank-imported row names its provider and adds the
 * edited note and the Needs review marker only when they apply, a manual row carries no marker, and
 * the marker's controls are never nested inside the row's own button, nor open the row when pressed
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
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

/** Whether any button opens before the button around it has closed */
function hasNestedButton(markup: string): boolean {
  let depth = 0
  for (const [tag] of markup.matchAll(/<\/?button\b/g)) {
    depth += tag.startsWith('</') ? -1 : 1
    if (depth > 1) return true
  }
  return false
}

describe('bank marker', () => {
  it('names the provider on a bank-imported row and nothing more while it is untouched', () => {
    const markup = renderRow({ providerName: 'SimpleFIN', isEdited: false, needsReview: false })

    expect(markup).toContain('aria-label="From SimpleFIN"')
    expect(markup).not.toContain('You edited a value the bank supplied')
    expect(markup).not.toContain('Needs review')
  })

  it('adds the edited note and the Needs review marker when they apply, outside the row button', () => {
    const markup = renderRow({ providerName: 'SimpleFIN', isEdited: true, needsReview: true, onShowReview: () => {} })

    expect(markup).toContain('From SimpleFIN. You edited a value the bank supplied')
    expect(markup).toContain('aria-label="Needs review. Show the waiting item"')
    expect(hasNestedButton(markup)).toBe(false)
  })

  it('names the row button from the content it sits under', () => {
    const markup = renderRow({ providerName: 'SimpleFIN', isEdited: false, needsReview: false })
    const labelledBy = markup.match(/<button[^>]*aria-labelledby="([^"]+)"/)?.[1]

    expect(labelledBy).toBeDefined()
    expect(markup).toContain(`id="${labelledBy}" data-testid="transaction-row-transaction-1"`)
  })

  it('keeps a press on the marker from reaching the row', () => {
    const marker = BankMarker({ providerName: 'SimpleFIN', isEdited: false, needsReview: true })
    const stopPropagation = vi.fn()

    marker.props.onClick({ stopPropagation })

    expect(stopPropagation).toHaveBeenCalledOnce()
  })

  it('leaves a manual row without any marker', () => {
    const markup = renderRow()

    expect(markup).toContain('Corner Grocer')
    expect(markup).not.toContain('From SimpleFIN')
  })
})
