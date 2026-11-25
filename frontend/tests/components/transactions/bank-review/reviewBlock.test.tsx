/**
 * Covers the rows of the review block above the transaction list: the first four items and the
 * toggle for the rest, how a removal and money in show their amounts, that every row opens its item,
 * and how a read that failed is said inside the block
 *
 * These tests catch the block hiding the toggle a long backlog needs, offering one a short backlog
 * doesn't, a removal showing anything but the ledger amount struck through, a kind of item whose row
 * a keyboard can't open, a failed read counting nothing as zero or offering no retry, Approve all
 * missing from the line under the header or drawn with nothing saying what the rules do, and a row showing no
 * merchant or category a rule gave it, or changed for one no rule matched. The
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

// The crossfade of the buttons' labels needs a browser to mount, so the label is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))

import { BankReviewBlock } from '@/components/transactions/bank-review/ReviewBlock'

const ITEMS = Array.from({ length: 6 }, (_, index) => createReviewItem(`item-${index}`, 'new', 'everyday'))

function renderBlock(
  items: BankReviewItem[],
  expanded: boolean,
  overrides: Partial<
    Pick<Parameters<typeof BankReviewBlock>[0], 'itemsFailure' | 'backlogFailure' | 'selection' | 'ruleActions'>
  > = {},
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

describe('Approve all beside the line under the header', () => {
  const ruleActions = {
    rules: { any_addable: true, changed: false, read_only_reason: null },
    busy: null,
    onApprove: () => {},
    onApplyRules: () => {},
  }

  it('is drawn once, beside the line under the header and above the rows, at every width', () => {
    const markup = renderBlock(ITEMS, false, { ruleActions })
    const line = markup.indexOf('Bank items stay out of every balance')
    const beside = markup.indexOf('Approve all', line)

    expect(markup.indexOf('Approve all')).toBe(beside)
    expect(beside).toBeGreaterThan(line)
    expect(beside).toBeLessThan(markup.indexOf('role="list"'))
  })

  it('leaves the header to the title, the count and the toggle, so the toggle is its only control', () => {
    const markup = renderBlock(ITEMS, false, { ruleActions })
    const header = markup.slice(0, markup.indexOf('Bank items stay out of every balance'))

    expect(header).toContain('aria-expanded=')
    expect(header).not.toContain('Approve all')
  })

  it('is left out while the items could not load, and when nothing says what the rules do', () => {
    expect(renderBlock([], false, { ruleActions, itemsFailure: { retry: () => {}, isRetrying: false } })).not.toContain(
      'Approve all',
    )
    expect(renderBlock(ITEMS, false, { ruleActions: { ...ruleActions, rules: null } })).not.toContain('Approve all')
    expect(renderBlock(ITEMS, false)).not.toContain('Approve all')
  })
})

describe('the offer to apply the rules again', () => {
  const ruleActions = {
    rules: { any_addable: true, changed: true, read_only_reason: null },
    busy: null as 'approve' | 'apply' | null,
    onApprove: () => {},
    onApplyRules: () => {},
  }
  const LINE = 'Your import rules changed after these items arrived.'

  /** Each button of the markup named `name`, the label measured out of sight inside it included */
  const buttonsNamed = (markup: string, name: string) =>
    [...markup.matchAll(/<button[^>]*>(?:(?!<\/button>).)*<\/button>/g)]
      .map((match) => match[0])
      .filter((button) => button.includes(name))

  it('shows under the first line, with its button, once the rules changed', () => {
    const markup = renderBlock(ITEMS, false, { ruleActions })
    const first = markup.indexOf('Bank items stay out of every balance')
    const offer = markup.indexOf(LINE)

    expect(offer).toBeGreaterThan(first)
    expect(offer).toBeLessThan(markup.indexOf('role="list"'))
    expect(markup.slice(offer, markup.indexOf('role="list"'))).toContain('>Reapply updated rules<')
    expect(buttonsNamed(markup, 'Reapply updated rules')).toHaveLength(1)
    // The line is a polite status, so a screen reader hears it arrive
    expect(markup).toMatch(/role="status"[^>]*>Your import rules changed/)
  })

  it('draws the import rules icon before its sentence, hidden from assistive technology, and none without the offer', () => {
    // Between the first line and the rows, the offer's icon is the only drawing, found by what it is: hidden from assistive technology
    const hiddenDrawings = (markup: string) => {
      const start = markup.indexOf('Bank items stay out of every balance')
      const between = markup.slice(start, markup.indexOf('role="list"'))
      return [...between.matchAll(/<svg[^>]*aria-hidden="true"[^>]*>/g)].map((match) => ({ at: start + match.index }))
    }
    const markup = renderBlock(ITEMS, false, { ruleActions })
    const found = hiddenDrawings(markup)

    expect(found).toHaveLength(1)
    expect(found[0].at).toBeLessThan(markup.indexOf(LINE))

    const unchanged = { ...ruleActions, rules: { any_addable: true, changed: false, read_only_reason: null } }
    expect(hiddenDrawings(renderBlock(ITEMS, false, { ruleActions: unchanged }))).toHaveLength(0)
  })

  it('is left out while the rules are unchanged, unknown or the items could not load', () => {
    const unchanged = { ...ruleActions, rules: { any_addable: true, changed: false, read_only_reason: null } }

    expect(renderBlock(ITEMS, false, { ruleActions: unchanged })).not.toContain(LINE)
    expect(renderBlock(ITEMS, false, { ruleActions: { ...ruleActions, rules: null } })).not.toContain(LINE)
    expect(renderBlock(ITEMS, false)).not.toContain(LINE)
    expect(renderBlock([], false, { ruleActions, itemsFailure: { retry: () => {}, isRetrying: false } })).not.toContain(
      LINE,
    )
  })

  it('leaves Approve all live while it shows', () => {
    const markup = renderBlock(ITEMS, false, { ruleActions })

    const buttons = buttonsNamed(markup, 'Approve all')

    expect(buttons).toHaveLength(1)
    expect(buttons[0]).not.toMatch(/ disabled=""|aria-disabled/)
  })

  it.each([
    ['approve', 'Approve all', 'Reapply updated rules'],
    ['apply', 'Reapply updated rules', 'Approve all'],
  ] as const)('holds the other button off while %s runs, never both busy', (busy, running, waiting) => {
    const markup = renderBlock(ITEMS, false, { ruleActions: { ...ruleActions, busy } })
    const named = (name: string) => buttonsNamed(markup, name)

    expect(named(running).length).toBeGreaterThan(0)
    for (const button of named(running)) expect(button).toContain('aria-busy="true"')
    expect(named(waiting).length).toBeGreaterThan(0)
    for (const button of named(waiting)) {
      expect(button).toMatch(/ disabled=""/)
      expect(button).toContain('aria-busy="false"')
    }
  })
})

describe('the values a rule gave a waiting row', () => {
  const rule = { id: 'rule-1', name: 'Pay' }
  const fillOf = (merchantName: string | null, categoryName: string | null) => ({
    merchant: merchantName ? { id: 'm', name: merchantName, rule } : null,
    category: categoryName ? { id: 'c', name: categoryName, kind: 'expense' as const, rule } : null,
    tags: [],
    category_left_out: null,
    tags_left_out: null,
  })
  const detailsOf = (item: BankReviewItem) =>
    /data-testid="review-item-details"[^>]*>(.*?)<\/p>/s.exec(renderBlock([item], false))?.[1].replace(/<[^>]+>/g, '')

  it('shows the merchant and the category in the plain muted line under the description, with no label of its own', () => {
    const matched = createReviewItem('matched', 'new', 'everyday', { rule_fill: fillOf('Market', 'Groceries') })

    expect(detailsOf(matched)).toBe('Sep 21 · Everyday · Market · Groceries')
    expect(renderBlock([matched], false)).not.toContain('Filled in')
  })

  it('shows what is still missing after the values it gives, and leaves an unmatched row as it was', () => {
    expect(detailsOf(createReviewItem('part', 'new', 'everyday', { rule_fill: fillOf('Market', null) }))).toBe(
      'Sep 21 · Everyday · Market · Needs category',
    )
    expect(detailsOf(createReviewItem('plain', 'new', 'everyday'))).toBe(
      'Sep 21 · Everyday · Needs merchant and category',
    )
  })
})

describe('the block while the list is in selection mode', () => {
  const MIXED = [
    createReviewItem('fresh', 'new', 'everyday'),
    createReviewItem('ticked', 'new', 'everyday'),
    createReviewItem('changed', 'correction', 'everyday'),
    createReviewItem('gone', 'removal', 'everyday'),
  ]

  /** A selection holding the ticked item, full so nothing else can be ticked */
  function selection(full: boolean) {
    return {
      markFor: (itemId: string) => (itemId === 'ticked' ? ('selected' as const) : ('none' as const)),
      isSelectable: (itemId: string) => itemId === 'ticked' || !full,
      onToggle: () => {},
      onPointerEnter: () => {},
      onPointerLeaveList: () => {},
    }
  }

  it('gives new items a checkbox of their own and leaves corrections and removals without one', () => {
    const rows = renderBlock(MIXED, false, { selection: selection(false) })
      .split('role="listitem"')
      .slice(1)

    expect(rows[0]).toMatch(
      /role="checkbox" aria-checked="false"[^>]*aria-label="Select GROCER fresh, waiting for review"/,
    )
    expect(rows[1]).toMatch(
      /role="checkbox" aria-checked="true"[^>]*aria-label="Select GROCER ticked, waiting for review"/,
    )
    expect(rows[2]).not.toContain('role="checkbox"')
    expect(rows[3]).not.toContain('role="checkbox"')
  })

  it('keeps the checkbox as the only tab stop of a new item, and the button of a correction', () => {
    const rows = renderBlock(MIXED, false, { selection: selection(false) })
      .split('role="listitem"')
      .slice(1)

    expect(rows[0]).toMatch(/<button type="button" tabindex="-1"[^>]*>.*GROCER fresh/)
    expect(rows[2]).toMatch(/<button type="button"(?! tabindex)[^>]*>.*GROCER changed/)
  })

  it('marks a ticked row, and holds back the box of an unticked one once the selection is full', () => {
    const rows = renderBlock(MIXED, false, { selection: selection(true) })
      .split('role="listitem"')
      .slice(1)

    expect(rows[1]).toContain('background:var(--app-accent-soft)')
    expect(rows[0]).not.toContain('background:var(--app-accent-soft)')
    expect(rows[0]).toMatch(/title="Up to 1000 transactions and review items can be ticked at once"/)
    expect(rows[0]).toMatch(/role="checkbox"[^>]*disabled=""/)
    expect(rows[1]).not.toMatch(/role="checkbox"[^>]*disabled=""/)
  })

  // Adding an item writes it to its account, and a bulk Add takes only what can be ticked
  it("holds back the box of an item on a read-only account, with the account's reason", () => {
    const reason = 'Records in USD are read-only. They can be archived or deleted'
    const rows = renderBlock(MIXED, false, {
      selection: {
        ...selection(false),
        isSelectable: (itemId: string) => itemId !== 'fresh',
        readOnlyReasonFor: (itemId: string) => (itemId === 'fresh' ? reason : undefined),
      },
    })
      .split('role="listitem"')
      .slice(1)

    expect(rows[0]).toContain(`title="${reason}"`)
    expect(rows[0]).toMatch(/role="checkbox"[^>]*disabled=""/)
    expect(rows[1]).not.toMatch(/role="checkbox"[^>]*disabled=""/)
  })

  it('shows no checkbox outside selection mode', () => {
    expect(renderBlock(MIXED, false)).not.toContain('role="checkbox"')
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
