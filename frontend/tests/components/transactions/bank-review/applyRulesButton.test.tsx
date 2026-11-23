/**
 * Covers the Apply rules button above the waiting items
 *
 * These tests catch the button staying live when no waiting item matches the rules or none can be
 * added, giving the wrong reason for either, hiding the reason from a screen reader, and a button
 * that can be pressed again while its press is running
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The crossfade needs a browser to mount, so the button's content is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))

import { ApplyRulesButton } from '@/components/transactions/bank-review/ApplyRulesButton'

function render(rules: { any_matches: boolean; any_addable: boolean }, isApplying = false): string {
  return renderToStaticMarkup(
    createElement(ApplyRulesButton, { rules: { version: 'v1', ...rules }, isApplying, onApply: () => {} }),
  )
}

describe('the Apply rules button', () => {
  it('is live when the rules can add a waiting item', () => {
    const markup = render({ any_matches: true, any_addable: true })

    expect(markup).toContain('>Apply rules<')
    expect(markup).not.toContain('aria-disabled')
  })

  it.each([
    [{ any_matches: false, any_addable: false }, 'No waiting item matches your import rules'],
    [{ any_matches: true, any_addable: false }, 'No waiting item can be added by your import rules'],
  ])('is greyed with its reason, still focusable, when the rules give %j', (rules, reason) => {
    const markup = render(rules)

    expect(markup).toContain('aria-disabled="true"')
    expect(markup).not.toMatch(/<button[^>]* disabled=""/)
    expect(markup).toContain(reason)
    expect(markup).toContain('>Apply rules<')
  })

  it('is held off and marked busy while a press runs, with no reason', () => {
    const markup = render({ any_matches: true, any_addable: true }, true)

    expect(markup).toMatch(/<button[^>]* disabled=""/)
    expect(markup).toContain('aria-busy="true"')
    expect(markup).not.toContain('No waiting item')
  })

  it('keeps the width of its label while a press runs, so nothing beside it moves', () => {
    const markup = render({ any_matches: true, any_addable: true }, true)

    // The width is fitted to the label. The label is still measured, out of sight, while the spinner shows
    expect(markup).toMatch(/<button[^>]* class="[^"]*w-\(--fit-width\)/)
    expect(markup).toMatch(/<span class="[^"]*invisible[^"]*" aria-hidden="true">.*>Apply rules</)
  })
})
