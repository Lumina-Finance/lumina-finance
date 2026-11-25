/**
 * Covers the Approve all button above the waiting items
 *
 * These tests catch the button staying live when no waiting item holds a merchant and a category,
 * giving the old reasons, hiding the reason from a screen reader, a button that can be pressed again
 * while its press is running, and one that stays live or shows a reason while Reapply updated rules runs. The width
 * it keeps while the spinner shows is measured in the browser
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The crossfade needs a browser to mount, so the button's content is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))

import { ApproveAllButton } from '@/components/transactions/bank-review/ApproveAllButton'

function render(anyAddable: boolean, state: { isApproving?: boolean; isHeldOff?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(ApproveAllButton, {
      rules: { any_addable: anyAddable, read_only_reason: null },
      isApproving: false,
      isHeldOff: false,
      onApprove: () => {},
      ...state,
    }),
  )
}

describe('the Approve all button', () => {
  it('is live when a waiting item holds a merchant and a category', () => {
    const markup = render(true)

    expect(markup).toContain('>Approve all<')
    expect(markup).not.toContain('aria-disabled')
  })

  it('is greyed with its one reason, still focusable, when no waiting item has both', () => {
    const markup = render(false)

    expect(markup).toContain('aria-disabled="true"')
    expect(markup).not.toMatch(/<button[^>]* disabled=""/)
    expect(markup).toContain('No waiting item is ready to add: each needs a merchant and a category')
    expect(markup).toContain('>Approve all<')
  })

  it('is held off and marked busy while its press runs, with no reason', () => {
    const markup = render(true, { isApproving: true })

    expect(markup).toMatch(/<button[^>]* disabled=""/)
    expect(markup).toContain('aria-busy="true"')
    expect(markup).not.toContain('No waiting item')
  })

  it('is held off with no reason and not busy while Reapply updated rules runs, even with nothing to add', () => {
    for (const anyAddable of [true, false]) {
      const markup = render(anyAddable, { isHeldOff: true })

      expect(markup).toMatch(/<button[^>]* disabled=""/)
      expect(markup).toContain('aria-busy="false"')
      expect(markup).not.toContain('No waiting item')
    }
  })
})
