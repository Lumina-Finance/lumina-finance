import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { TransactionsOverview } from '@/api/transactions'

vi.mock('@/pages/transactions/components/top-band/NetFlowSummary', () => ({
  default: () => createElement('p', null, 'Summary metrics'),
}))
vi.mock('@/pages/transactions/components/top-band/MostExpensiveTransactionsPanel', () => ({
  default: () => createElement('button', null, 'Outlier edit action'),
}))
vi.mock('@/pages/transactions/components/top-band/TopCategoriesChart', () => ({ default: () => null }))
vi.mock('@/pages/transactions/components/top-band/DailyCashFlowChart', () => ({ default: () => null }))
vi.mock('@/pages/transactions/components/FilterLoadingOverlay', () => ({
  default: () => createElement('p', null, 'Loading transaction summary'),
}))

import TopBand from '@/pages/transactions/components/TopBand'

/** Render the actual wrapper while replacing chart internals that require browser geometry */
function render({ loading = false, failed = false, overview }: {
  loading?: boolean
  failed?: boolean
  overview?: TransactionsOverview
} = {}) {
  return renderToStaticMarkup(createElement(TopBand, {
    overview, loading, failed, displayCurrency: 'CAD', retrying: false, skipEntrance: true,
    rangeLabel: 'Test range', fromDate: '2026-01-01', toDate: '2026-01-31',
    chartAnimationKey: 'test', prefersReducedMotion: true, openingOutlierId: null,
    outlierLoadError: null, onRetry: () => {}, onOpenOutlierTransaction: () => {},
  }))
}

const HIDDEN_WRAPPER = '<div inert="" aria-hidden="true">'

describe('transaction summary content accessibility', () => {
  it('hides settled sample content while keeping the empty message outside it', () => {
    const markup = render()
    expect(markup).toContain(HIDDEN_WRAPPER)
    expect(markup.indexOf('No transaction data for Test range.')).toBeLessThan(markup.indexOf(HIDDEN_WRAPPER))
    expect(markup.indexOf('Outlier edit action')).toBeGreaterThan(markup.indexOf(HIDDEN_WRAPPER))
  })

  it('preserves the loading presentation', () => {
    const markup = render({ loading: true })
    expect(markup).not.toContain(HIDDEN_WRAPPER)
    expect(markup).toContain('Loading transaction summary')
    expect(markup).not.toContain('No transaction data')
  })

  it('retains failure protection and an accessible sibling retry action', () => {
    const markup = render({ failed: true })
    expect(markup).toContain(HIDDEN_WRAPPER)
    expect(markup.indexOf('role="alert"')).toBeLessThan(markup.indexOf(HIDDEN_WRAPPER))
    expect(markup.indexOf('aria-label="Try again"')).toBeLessThan(markup.indexOf(HIDDEN_WRAPPER))
    expect(markup).toContain('aria-label="Try again"')
  })

  it('keeps genuine summary data accessible', () => {
    const fx = { state: 'complete' as const, missing_pairs: [] }
    const markup = render({ overview: {
      total_inflow: 0, total_outflow: -4250, net_flow_fx_status: fx,
      outliers: [], outliers_fx_status: fx, top_categories: [], top_categories_fx_status: fx,
      daily_cash_flow: [], daily_cash_flow_fx_status: fx,
    } })
    expect(markup).not.toContain(HIDDEN_WRAPPER)
    expect(markup).toContain('Outlier edit action')
    expect(markup).not.toContain('No transaction data')
  })
})
