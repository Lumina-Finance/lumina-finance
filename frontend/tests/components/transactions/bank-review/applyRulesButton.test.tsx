/**
 * Covers the Reapply updated rules link in the offer under the block's first line
 *
 * These tests catch a link that can be pressed again while its press runs, one that stays live
 * while Approve all runs, and a busy mark or a reason showing on the link that only waits. The width
 * it keeps while its press runs is measured in the browser
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ApplyRulesButton } from '@/components/transactions/bank-review/ApplyRulesButton'

function render(state: { isApplying?: boolean; isHeldOff?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(ApplyRulesButton, { isApplying: false, isHeldOff: false, onApply: () => {}, ...state }),
  )
}

describe('the Reapply updated rules button', () => {
  it('is live and not busy when nothing runs', () => {
    const markup = render()

    expect(markup).toContain('>Reapply updated rules<')
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
