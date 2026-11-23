/**
 * Guards a read-only category's row in the categories table. The row is the control that opens the
 * category, so it stays the row's one tab stop: its pills take none, so Enter or Space can't open the
 * category from a pill, and the row shows the reason on its own keyboard focus
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createPlan } from '@tests/pages/accounts/components/fixtures'

vi.mock('@/api/tax-advantaged-categories', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/tax-advantaged-categories')>()),
  useTaxAdvantagedCategoryLimits: () => ({ data: [], isLoading: false }),
}))

import TaxAdvantagedCategoriesTable from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/table/CategoriesTable'

const REASON = 'Records in USD are read-only. They can be archived or deleted'

function renderTable(readOnlyReason: string | null): string {
  return renderToStaticMarkup(
    <TaxAdvantagedCategoriesTable
      currentYear={2026}
      linkedAccountCounts={new Map()}
      onSelect={() => {}}
      plans={[createPlan({ currency: 'USD', read_only_reason: readOnlyReason })]}
    />,
  )
}

describe('a read-only category in the categories table', () => {
  it('keeps the row as its one tab stop, with pills that take none', () => {
    const markup = renderTable(REASON)

    expect(markup).toContain('data-testid="read-only-reason-pill"')
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1)
    expect(markup).toMatch(/<tr\b[^>]*tabindex="0"/)
  })

  it('gives each layout its own pill id', () => {
    const ids = [...renderTable(REASON).matchAll(/<span id="([^"]+)" data-testid="read-only-reason-pill"/g)].map(
      ([, id]) => id,
    )

    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })
})
