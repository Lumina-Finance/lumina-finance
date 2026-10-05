/**
 * Covers the rows of the review block above the transaction list: the first four items and the
 * toggle for the rest, and how a removal and money in show their amounts
 *
 * These tests catch the block hiding the toggle a long backlog needs, offering one a short backlog
 * doesn't, and a removal showing anything but the ledger amount struck through
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BankReviewItem } from '@/api/bank-sync/types'
import { formatCurrency, formatMovedCurrency } from '@/utils/formatCurrency'
import { createReviewItem, MINUS, rowCount, TEST_CURRENCIES } from './fixtures'

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies: TEST_CURRENCIES,
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, TEST_CURRENCIES),
    formatMovedCurrency: (amount: number, currency: string) => formatMovedCurrency(amount, currency, TEST_CURRENCIES),
  }),
}))

import { BankReviewBlock } from '@/components/transactions/bank-review/ReviewBlock'

const ITEMS = Array.from({ length: 6 }, (_, index) => createReviewItem(`item-${index}`, 'new', 'everyday'))

function renderBlock(items: BankReviewItem[], expanded: boolean): string {
  return renderToStaticMarkup(createElement(BankReviewBlock, {
    items,
    total: items.length,
    accountFor: () => ({ name: 'Everyday', currency: 'USD' }),
    showAccountNames: true,
    today: '2026-10-05',
    backlogNotice: null,
    backlogError: null,
    expanded,
    onToggleExpanded: () => {},
    rowsInViewAtClose: null,
    onRowsLeft: () => {},
    hasMoreItems: false,
    isLoadingMore: false,
    loadMoreSentinelRef: () => {},
    skipEnterAnimation: false,
    highlightedId: null,
    registerRow: () => {},
    prefersReducedMotion: true,
  }))
}

describe('the rows the block shows', () => {
  it('shows the first four items until opened, then every one', () => {
    const collapsed = renderBlock(ITEMS, false)
    const expanded = renderBlock(ITEMS, true)

    expect(rowCount(collapsed)).toBe(4)
    expect(collapsed).toMatch(/aria-expanded="false"[^>]*>Show all 6</)
    expect(rowCount(expanded)).toBe(6)
    expect(expanded).toMatch(/aria-expanded="true"[^>]*>Show fewer</)
  })

  it('offers no toggle for four items or fewer', () => {
    expect(renderBlock(ITEMS.slice(0, 4), false)).not.toContain('Show all')
  })

  it('strikes through the ledger amount a removal would take out, and colours money in', () => {
    const refund = createReviewItem('refund', 'new', 'everyday')
    const markup = renderBlock([
      createReviewItem('uber', 'removal', 'everyday'),
      { ...refund, bank: { ...refund.bank, amount: 4250 } },
    ], false)

    expect(markup).toMatch(new RegExp(`text-decoration:line-through[^>]*>${MINUS}\\$18\\.00<`))
    expect(markup).toMatch(/color:var\(--app-positive\)[^>]*>\+\$42\.50</)
  })
})
