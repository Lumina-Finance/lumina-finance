import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { useTransactionNavigationFilters } from '@/pages/transactions/hooks/useTransactionNavigationFilters'

/** Reads the real hook during the very first render, before any synchronization effect could run */
function FirstRender() {
  const { filters } = useTransactionNavigationFilters()
  return <output>{JSON.stringify(filters)}</output>
}

describe('address-owned transaction filters', () => {
  it('supplies category and date filters on the initial render', () => {
    const id = '12345678-1234-1234-1234-123456789abc'
    const markup = renderToStaticMarkup(<MemoryRouter initialEntries={[`/transactions?category_id=${id}&from_date=2024-02-29&to_date=2024-03-01`]}><FirstRender /></MemoryRouter>)
    expect(markup).toContain(id)
    expect(markup).toContain('2024-02-29')
    expect(markup).toContain('2024-03-01')
  })

  it('never supplies malformed address values to the first query', () => {
    const markup = renderToStaticMarkup(<MemoryRouter initialEntries={['/transactions?category_id=junk&from_date=2024-02-30&to_date=junk']}><FirstRender /></MemoryRouter>)
    expect(markup).toBe('<output>{}</output>')
  })
})
