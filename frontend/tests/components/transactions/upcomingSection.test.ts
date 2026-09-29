/**
 * Tests the Upcoming section's markup, so its count and dates read right for one transaction and for several,
 * it starts closed without rendering the rows, it explains above the rows why they don't count, a refund
 * inside loses its colour and its icon dims, and a read-only row inside keeps readable text rather than
 * fading twice
 */
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TransactionRowView } from '@/components/transactions/Row'
import { UPCOMING_EXPLANATION, UpcomingSection } from '@/components/transactions/UpcomingSection'

// React escapes apostrophes in markup, so the copy is compared in that form
const RENDERED_EXPLANATION = UPCOMING_EXPLANATION.replaceAll("'", '&#x27;')

function render(
  transactionDates: string[],
  expanded: boolean,
  children: ReactNode = createElement('p', null, 'Rent row'),
) {
  return renderToStaticMarkup(
    createElement(UpcomingSection, { transactionDates, today: '2026-09-28', expanded, onToggle: () => {}, children }),
  )
}

// A row on an archived account, which fades on its own to say it can't be edited
const readOnlyRent = createElement(TransactionRowView, {
  transaction: { id: 'rent', dt: '2026-10-03', merchant_name: 'Rent', notes: null, tags: [], counterparty_account_scope: null },
  amountPresentation: { text: '-$1,500.00', sign: -1 },
  category: undefined,
  readOnlyReason: 'Archived',
  skipEnterAnimation: true,
  onOpen: () => {},
})

// A refund on a groceries expense, which the list draws in the colour of money coming in
const groceriesRefund = createElement(TransactionRowView, {
  transaction: { id: 'refund', dt: '2026-10-03', merchant_name: 'Grocer', notes: null, tags: [], counterparty_account_scope: null },
  amountPresentation: { text: '+$20.00', sign: 1 },
  category: { id: 'groceries', owner_id: null, group_id: null, name: 'Groceries', kind: 'expense', icon: null, is_system: true, created_at: '2024-01-01T00:00:00Z' },
  skipEnterAnimation: true,
  onOpen: () => {},
})

describe('UpcomingSection', () => {
  it('renders nothing when no transaction is upcoming', () => {
    expect(render([], false)).toBe('')
  })

  it('counts one transaction and shows its single date', () => {
    const markup = render(['2026-10-03'], false)

    expect(markup).toContain('>1<')
    expect(markup).toContain('>Oct 3<')
  })

  it('counts several transactions and shows the range they fall in, from the earliest', () => {
    const markup = render(['2026-11-03', '2026-10-28', '2026-11-03'], false)

    expect(markup).toContain('>3<')
    expect(markup).toContain('>Oct 28 – Nov 3<')
  })

  it('starts closed, saying so, without rendering the rows or their explanation', () => {
    const markup = render(['2026-10-03'], false)

    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('Rent row')
    expect(markup).not.toContain(RENDERED_EXPLANATION)
  })

  it('shows the explanation above the rows once open', () => {
    const markup = render(['2026-10-03'], true)

    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain(RENDERED_EXPLANATION)
    expect(markup.indexOf('Rent row')).toBeGreaterThan(markup.indexOf(RENDERED_EXPLANATION))
  })

  it('draws a refund inside in the muted text and dims its category icon in every layout', () => {
    expect(renderToStaticMarkup(groceriesRefund)).toContain('var(--app-positive)')

    const markup = render(['2026-10-03'], true, groceriesRefund)

    expect(markup).not.toContain('var(--app-positive)')
    expect(markup.match(/opacity:0.75/g)).toHaveLength(3)
  })

  it("keeps a read-only row at the section's muted colours instead of also lowering its opacity", () => {
    expect(renderToStaticMarkup(readOnlyRent)).toContain('opacity:0.68')

    const markup = render(['2026-10-03'], true, readOnlyRent)

    expect(markup).toContain('Rent')
    expect(markup).not.toContain('opacity:0.68')
  })
})
