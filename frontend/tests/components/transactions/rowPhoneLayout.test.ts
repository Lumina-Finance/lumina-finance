/**
 * Tests that a row can be laid out as it is on a phone at every width, as the picker for linking a refund
 * shows it, without the wide layout's cells, and that a row shown as a toggle says whether it is picked
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TransactionRowView } from '@/components/transactions/Row'

function render(props: { phoneLayout?: boolean; pressed?: boolean }) {
  return renderToStaticMarkup(
    createElement(TransactionRowView, {
      transaction: {
        id: 'refund',
        dt: '2026-10-03',
        merchant_name: 'Grocer',
        notes: 'Store credit',
        tags: [],
        counterparty_account_scope: null,
      },
      amountPresentation: { text: '+$20.00', sign: 1 },
      category: {
        id: 'groceries',
        owner_id: null,
        group_id: null,
        name: 'Groceries',
        kind: 'expense',
        icon: null,
        is_system: true,
        created_at: '2024-01-01T00:00:00Z',
      },
      accountName: 'Everyday',
      skipEnterAnimation: true,
      onOpen: () => {},
      ...props,
    }),
  )
}

describe('TransactionRowView phone layout', () => {
  it('draws the wide layout from 750px by default, with the phone cells hidden there', () => {
    const markup = render({})

    expect(markup).toContain('min-[750px]:hidden')
    expect(markup).toContain('min-[750px]:grid-cols-subgrid')
  })

  it('draws only the phone cells, at every width, when asked', () => {
    const markup = render({ phoneLayout: true })

    expect(markup).not.toContain('min-[750px]')
    expect(markup).toContain('Grocer')
    expect(markup).toContain('+$20.00')
    expect(markup).toContain('Everyday')

    // The amount is drawn once, where the wide layout would add a second
    expect(markup.match(/data-testid="transaction-amount"/g)).toHaveLength(1)
  })

  it('says whether it is picked only when it is used as a toggle', () => {
    expect(render({})).not.toContain('aria-pressed')
    expect(render({ pressed: false })).toContain('aria-pressed="false"')
    expect(render({ pressed: true })).toContain('aria-pressed="true"')
  })
})
