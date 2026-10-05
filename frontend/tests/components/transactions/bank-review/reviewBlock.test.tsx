/**
 * Covers the rows of the review block above the transaction list: the first four items and the
 * toggle for the rest, how a removal and money in show their amounts, and how a read that failed
 * is said inside the block
 *
 * These tests catch the block hiding the toggle a long backlog needs, offering one a short backlog
 * doesn't, a removal showing anything but the ledger amount struck through, a failed read counting
 * nothing as zero or offering no retry, and a retry that drops keyboard focus while it waits.
 * Following a Needs review marker to a failed read runs in the browser, since it needs effects
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

function renderBlock(
  items: BankReviewItem[],
  expanded: boolean,
  failures: Partial<Pick<Parameters<typeof BankReviewBlock>[0], 'itemsFailure' | 'backlogFailure'>> = {},
): string {
  return renderToStaticMarkup(createElement(BankReviewBlock, {
    items,
    total: items.length,
    itemsFailure: null,
    itemsRetryRef: null,
    accountFor: () => ({ name: 'Everyday', currency: 'USD' }),
    showAccountNames: true,
    today: '2026-10-05',
    backlogNotice: null,
    backlogFailure: null,
    ...failures,
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

describe('a read that failed', () => {
  const failed = { retry: () => {}, isRetrying: false }

  it('says the items could not load in place of their count and rows, offering to try again', () => {
    const markup = renderBlock([], false, { itemsFailure: failed })

    expect(markup).toContain('Waiting for review')
    expect(markup).toMatch(/role="alert"[^>]*>.*Bank items to review could not load\.<\/span><button[^>]*>Try again<\/button>/)
    expect(markup).not.toMatch(/>0<\/span>/)
    expect(rowCount(markup)).toBe(0)
  })

  it('says the pause status could not load above the rows, offering to try again', () => {
    const markup = renderBlock(ITEMS, false, { backlogFailure: failed })

    expect(markup).toMatch(/role="alert"[^>]*>.*Sync pause status could not load\.<\/span><button[^>]*>Try again<\/button>/)
    expect(markup).toMatch(/>6<\/span>/)
    expect(rowCount(markup)).toBe(4)
  })

  it('says it is trying again, with the retry busy but still focusable', () => {
    const markup = renderBlock([], false, { itemsFailure: { ...failed, isRetrying: true } })

    expect(markup).toMatch(/<button[^>]*aria-disabled="true"[^>]*aria-busy="true"[^>]*>Retrying…<\/button>/)
    expect(markup).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Retrying…/)
  })
})
