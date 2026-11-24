/**
 * Covers the Apply rules button in the offer under the block's first line
 *
 * These tests catch a button that can be pressed again while its press runs, one that stays live
 * while Approve all runs, and a busy mark or a reason showing on the button that only waits. The width
 * it keeps while the spinner shows is measured in the browser
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The crossfade needs a browser to mount, so the button's content is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))

import { ApplyRulesButton } from '@/components/transactions/bank-review/ApplyRulesButton'

function render(state: { isApplying?: boolean; isHeldOff?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(ApplyRulesButton, { isApplying: false, isHeldOff: false, onApply: () => {}, ...state }),
  )
}

describe('the Apply rules button', () => {
  it('is live and not busy when nothing runs', () => {
    const markup = render()

    expect(markup).toContain('>Apply rules<')
    expect(markup).toContain('aria-busy="false"')
    expect(markup).not.toMatch(/<button[^>]* disabled=""/)
  })

  it('is held off and marked busy while its press runs', () => {
    const markup = render({ isApplying: true })

    expect(markup).toMatch(/<button[^>]* disabled=""/)
    expect(markup).toContain('aria-busy="true"')
  })

  it('is held off, with no reason and not marked busy, while Approve all runs', () => {
    const markup = render({ isHeldOff: true })

    expect(markup).toMatch(/<button[^>]* disabled=""/)
    expect(markup).toContain('aria-busy="false"')
    expect(markup).not.toContain('aria-disabled')
  })
})
