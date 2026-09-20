import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { TransactionFilterPanel } from '@/pages/transactions/components/toolbar/FilterPanel'
import { useTransactionNavigationFilters } from '@/pages/transactions/hooks/useTransactionNavigationFilters'

vi.mock('@/pages/transactions/components/toolbar/useTransactionFilterDraft', () => ({
  useTransactionFilterDraft: () => ({ activeFacetCount: 0 }),
}))
vi.mock('@/pages/transactions/components/toolbar/FilterPanelBody', () => ({ FilterPanelBody: () => null }))
vi.mock('@/components/list-controls/FilterGlassPanel', () => ({
  FilterGlassPanel: ({ activeFacetCount }: { activeFacetCount: number }) => <output>{activeFacetCount}</output>,
}))

function RestoredPanel() {
  const { filters, setFilters } = useTransactionNavigationFilters()
  return <TransactionFilterPanel filters={filters} setFilter={setFilters} accountOptions={[]} categoryOptions={[]} showAccountFilter />
}

describe('closed transaction filter indicator', () => {
  it('shows URL filters on the first render while the unopened draft and options are empty', () => {
    const url = '/transactions?category_id=12345678-1234-1234-1234-123456789abc&from_date=2024-02-29&to_date=2024-03-01'
    expect(renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><RestoredPanel /></MemoryRouter>)).toBe('<output>2</output>')
  })

  it('shows no applied facets when the URL has no filters', () => {
    expect(renderToStaticMarkup(<MemoryRouter initialEntries={['/transactions']}><RestoredPanel /></MemoryRouter>)).toBe('<output>0</output>')
  })
})
