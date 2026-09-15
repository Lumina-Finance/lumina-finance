/**
 * Tests the transaction overview's visible state so query failures cannot be presented as truthful
 * empty results and every existing source of overview content remains recognized
 */
import { describe, expect, it } from 'vitest'
import type { TransactionsOverview } from '@/api/transactions'
import type { FxStatus } from '@/api/shared/fx'
import { selectTransactionOverviewState } from '@/pages/transactions/utils/overviewState'

const COMPLETE_FX: FxStatus = { state: 'complete', missing_pairs: [] }

/** Builds a complete overview response around the fields relevant to one state case */
function overview(overrides: Partial<TransactionsOverview> = {}): TransactionsOverview {
  return {
    total_inflow: null,
    total_outflow: null,
    net_flow_fx_status: COMPLETE_FX,
    top_categories: [],
    top_categories_fx_status: COMPLETE_FX,
    daily_cash_flow: [],
    daily_cash_flow_fx_status: COMPLETE_FX,
    outliers: [],
    outliers_fx_status: COMPLETE_FX,
    ...overrides,
  }
}

const RANGE_LABEL = 'Jun 1, 2026 – Jun 30, 2026'

/** Selects a state with terse defaults shared by the focused cases */
function select({
  data,
  loading = false,
  failed = false,
  rangeLabel = RANGE_LABEL,
}: {
  data?: TransactionsOverview
  loading?: boolean
  failed?: boolean
  rangeLabel?: string
}) {
  return selectTransactionOverviewState({ overview: data, loading, failed, rangeLabel })
}

describe('transaction overview presentation state', () => {
  it('reports a settled initial failure instead of an empty result', () => {
    expect(select({ failed: true })).toStrictEqual({ kind: 'failed' })
  })

  it('reports a settled refresh failure instead of presenting cached content as current', () => {
    expect(select({
      data: overview({ total_inflow: 120000, total_outflow: 50000 }),
      failed: true,
    })).toStrictEqual({ kind: 'failed' })
  })

  it('shows loading during a retry and content after a successful result settles', () => {
    const data = overview({ total_inflow: 120000, total_outflow: 50000 })

    expect(select({ data, loading: true, failed: true })).toStrictEqual({ kind: 'loading' })
    expect(select({ data })).toStrictEqual({ kind: 'content' })
  })

  it('preserves the no-transactions message and its range label verbatim', () => {
    const rangeLabel = 'A custom range label'

    expect(select({ data: overview(), rangeLabel })).toStrictEqual({
      kind: 'empty',
      message: `No transaction data for ${rangeLabel}.`,
    })
  })

  it('preserves the no-qualifying-transactions message and its range label verbatim', () => {
    const rangeLabel = 'Another custom range label'

    expect(select({
      data: overview({ total_inflow: 0, total_outflow: 0 }),
      rangeLabel,
    })).toStrictEqual({
      kind: 'empty',
      message: `No qualifying transactions for ${rangeLabel}`,
    })
  })

  it.each([
    ['non-zero net flow', { total_inflow: 1, total_outflow: 0 }],
    ['an outlier', { outliers: [{
      id: 'transaction-1',
      merchant_name: 'Market',
      notes: null,
      amount: -1000,
      currency: 'CAD',
      dt: '2026-06-15',
    }] }],
    ['a top category', { top_categories: [{
      category_id: 'category-1',
      category_name: 'Groceries',
      total: -1000,
    }] }],
    ['non-zero daily cash flow', { daily_cash_flow: [{
      date: '2026-06-15',
      end_date: '2026-06-15',
      inflow: 0,
      outflow: 1000,
    }] }],
  ] satisfies Array<[string, Partial<TransactionsOverview>]>)('recognizes content from %s', (_name, data) => {
    expect(select({ data: overview(data) })).toStrictEqual({ kind: 'content' })
  })
})
