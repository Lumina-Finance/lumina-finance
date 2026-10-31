/**
 * Tests that a transaction row with no usable institution logo draws the same beige "$" tile as the
 * accounts list, never the first letter of the account's name
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TransactionRowView } from '@/components/transactions/Row'

function render(accountName: string | undefined) {
  return renderToStaticMarkup(
    createElement(TransactionRowView, {
      accountName,
      accountInstitution: null,
      transaction: {
        id: 't1',
        dt: '2026-10-03',
        merchant_name: 'Grocer',
        notes: null,
        tags: [],
        counterparty_account_scope: null,
      },
      amountPresentation: { text: '-$20.00', sign: -1 },
      category: undefined,
      skipEnterAnimation: true,
      onOpen: () => {},
    }),
  )
}

describe('transaction row account logo placeholder', () => {
  it('draws the accent "$" on the soft accent tile, as the accounts list does', () => {
    const markup = render('Visa Travel')

    expect(markup).toContain('background:var(--app-accent-soft)')
    expect(markup).toContain('color:var(--app-accent)')
    expect(markup).toMatch(/>\$<\/span>/)
  })

  it('never draws a letter of the account name in place of the logo', () => {
    expect(render('Visa Travel')).not.toMatch(/leading-none[^>]*>V</)
  })
})
