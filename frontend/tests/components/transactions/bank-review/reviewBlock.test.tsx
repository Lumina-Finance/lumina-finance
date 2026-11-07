/**
 * Covers the rows of the review block above the transaction list: the first four items and the
 * toggle for the rest, how a removal and money in show their amounts, that every row opens its item,
 * and how a read that failed is said inside the block
 *
 * These tests catch the block hiding the toggle a long backlog needs, offering one a short backlog
 * doesn't, a removal showing anything but the ledger amount struck through, a kind of item whose row
 * a keyboard can't open, and a failed read counting nothing as zero or offering no retry. The
 * notice's own retry is covered with the notice, and following a Needs review marker to a failed
 * read, and opening an item, run in the browser, since they need effects and clicks
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
  overrides: Partial<Pick<Parameters<typeof BankReviewBlock>[0], 'itemsFailure' | 'backlogFailure'>> = {},
): string {
  return renderToStaticMarkup(
    createElement(BankReviewBlock, {
      items,
      total: items.length,
      itemsFailure: null,
      itemsRetryRef: null,
      accountFor: () => ({ name: 'Everyday', currency: 'USD' }),
      showAccountNames: true,
      today: '2026-10-05',
      backlogNotice: null,
      backlogFailure: null,
      ...overrides,
      expanded,
      onToggleExpanded: () => {},
      rowsInViewAtClose: null,
      onRowsLeft: () => {},
      hasMoreItems: false,
      isLoadingMore: false,
      loadMoreSentinelRef: () => {},
      skipEnterAnimation: false,
      highlightedId: null,
      isGoingToItem: false,
      registerRow: () => {},
      onOpenItem: () => {},
      prefersReducedMotion: true,
    }),
  )
}

describe('the rows the block shows', () => {
  it('puts the toggle in the header above the rows, so a long list is closed without scrolling to its end', () => {
    for (const expanded of [false, true]) {
      const markup = renderBlock(ITEMS, expanded)
      const toggle = markup.search(/aria-expanded=/)

      expect(toggle).toBeGreaterThan(-1)
      expect(toggle).toBeLessThan(markup.indexOf('role="list"'))
    }
  })

  it('shows the first four items until opened, then every one', () => {
    const collapsed = renderBlock(ITEMS, false)
    const expanded = renderBlock(ITEMS, true)

    expect(rowCount(collapsed)).toBe(4)
    expect(collapsed).toMatch(/aria-expanded="false"[^>]*aria-label="Show all 6"/)
    expect(rowCount(expanded)).toBe(6)
    expect(expanded).toMatch(/aria-expanded="true"[^>]*aria-label="Show fewer"/)
  })

  it('draws the toggle as a caret turned over while open, with no words of its own on screen', () => {
    const collapsed = renderBlock(ITEMS, false)
    const expanded = renderBlock(ITEMS, true)

    expect(collapsed).toMatch(/aria-label="Show all 6"[^>]*>(<svg[^>]*lucide-chevron-down(?! rotate-180))/)
    expect(expanded).toMatch(/aria-label="Show fewer"[^>]*><svg[^>]*rotate-180/)
    expect(collapsed).not.toContain('>Show all')
    expect(expanded).not.toContain('>Show fewer')
  })

  it('offers no toggle for four items or fewer', () => {
    expect(renderBlock(ITEMS.slice(0, 4), false)).not.toContain('Show all')
  })

  it('strikes through the ledger amount a removal would take out, and colours money in', () => {
    const refund = createReviewItem('refund', 'new', 'everyday')
    const markup = renderBlock(
      [createReviewItem('uber', 'removal', 'everyday'), { ...refund, bank: { ...refund.bank, amount: 4250 } }],
      false,
    )

    expect(markup).toMatch(new RegExp(`text-decoration:line-through[^>]*>${MINUS}\\$18\\.00<`))
    expect(markup).toMatch(/color:var\(--app-positive\)[^>]*>\+\$42\.50</)
  })

  it("makes every kind of item's row a button that opens it", () => {
    const markup = renderBlock(
      [
        createReviewItem('fresh', 'new', 'everyday'),
        createReviewItem('changed', 'correction', 'everyday'),
        createReviewItem('gone', 'removal', 'everyday'),
      ],
      false,
    )
    const rows = markup.split('role="listitem"').slice(1)

    expect(rows[0]).toMatch(/<button type="button"[^>]*>.*GROCER fresh/)
    expect(rows[1]).toMatch(/<button type="button"[^>]*>.*GROCER changed/)
    expect(rows[2]).toMatch(/<button type="button"[^>]*>.*GROCER gone/)
  })
})

describe('a read that failed', () => {
  const failed = { retry: () => {}, isRetrying: false }

  it('says the items could not load in place of their count and rows, offering to try again', () => {
    const markup = renderBlock([], false, { itemsFailure: failed })

    expect(markup).toContain('Waiting for review')
    expect(markup).toMatch(
      /role="alert"[^>]*>.*Bank items to review could not load\.<\/span><button[^>]*>Try again<\/button>/,
    )
    expect(markup).not.toMatch(/>0<\/span>/)
    expect(rowCount(markup)).toBe(0)
  })

  it('says the pause status could not load above the rows, offering to try again', () => {
    const markup = renderBlock(ITEMS, false, { backlogFailure: failed })

    expect(markup).toMatch(
      /role="alert"[^>]*>.*Sync pause status could not load\.<\/span><button[^>]*>Try again<\/button>/,
    )
    expect(markup).toMatch(/>6<\/span>/)
    expect(rowCount(markup)).toBe(4)
  })
})
