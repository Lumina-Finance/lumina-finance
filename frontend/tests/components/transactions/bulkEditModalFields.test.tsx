/**
 * Covers which fields the bulk edit modal offers for what is ticked: ledger transactions alone, items
 * waiting for review alone, or both, with its title and button wording for each
 *
 * These tests catch the modal offering Account and Direction to an item that keeps its own account,
 * letting Merchant or Category be left as they are when an item needs both, offering to override tags
 * or take a note off an item that has neither, and a button that doesn't say what it adds and updates
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ accessToken: null, user: null }) }))

// The real panel renders into a portal, and markup rendered to a string can't hold one
vi.mock('@/components/modal/TitledPanel', () => ({
  ModalTitledPanel: ({ title, footer, children }: { title: string; footer: ReactNode; children: ReactNode }) => (
    <div>
      <h2>{title}</h2>
      {children}
      {footer}
    </div>
  ),
}))

// The date field's calendar renders into a portal on the page, and markup rendered to a string has no page
vi.mock('@/components/date-field/DateField', () => ({ default: () => <input aria-label="Date" /> }))

import { BulkEditModal } from '@/components/transactions/bulk-edit/BulkEditModal'
import { groceries, oldImport, writableAccounts } from './bulkEditFixtures'

function render(rows: (typeof groceries)[], reviewCount: number): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <BulkEditModal
        open
        onClose={() => {}}
        onExitComplete={() => {}}
        rows={rows}
        selectedCurrencies={rows.length ? ['CAD'] : []}
        accounts={writableAccounts}
        reviewCount={reviewCount}
        onApply={() => {}}
      />
    </QueryClientProvider>,
  )
}

/** The text of the button that applies the edit, the last one in the footer */
function applyLabel(markup: string): string | undefined {
  return [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].at(-1)?.[1]
}

describe('the fields the bulk edit offers', () => {
  it('offers every field, each left as it is until chosen, for ledger transactions alone', () => {
    const markup = render([groceries, oldImport], 0)

    expect(markup).toContain('<h2>Edit 2 transactions</h2>')
    expect(markup).toContain('Account &amp; Direction')
    expect(markup).toContain('Override existing tags')
    expect(markup).toContain('Take the note off instead')
    expect(markup).not.toContain('Choose a merchant')
    expect(applyLabel(markup)).toBe('Apply')
  })

  it('offers only what an item takes, with Merchant and Category to choose, for items waiting for review alone', () => {
    const markup = render([], 4)

    expect(markup).toContain('<h2>Add 4 items to your ledger</h2>')
    expect(markup).not.toContain('Account &amp; Direction')
    expect(markup).not.toContain('Override existing tags')
    expect(markup).not.toContain('Take the note off instead')
    expect(markup).toContain('Choose a merchant')
    expect(markup).toContain('Choose a category')
    for (const label of ['Date', 'Merchant', 'Category', 'Add a tag', 'Note']) {
      expect(markup).toContain(`>${label}<`)
    }
    expect(applyLabel(markup)).toBe('Add 4 to ledger')
  })

  it('offers the fields both take, still able to change the ledger tags and note, for both kinds', () => {
    const markup = render([groceries, oldImport, groceries], 2)

    expect(markup).toContain('<h2>Add 2 items and update 3 transactions</h2>')
    expect(markup).not.toContain('Account &amp; Direction')
    expect(markup).toContain('Override existing tags')
    expect(markup).toContain('Take the note off instead')
    expect(markup).toContain('Choose a merchant')
    expect(applyLabel(markup)).toBe('Add 2 and update 3')
  })
})
