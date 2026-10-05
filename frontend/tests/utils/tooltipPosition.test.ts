/**
 * Covers the bars a tooltip opening upwards keeps clear of
 *
 * These tests catch the page's stuck bars pushing a tooltip in a dialog below its icon, when the
 * dialog is drawn over those bars
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTooltipCoverBottom } from '@/utils/tooltipPosition'

// A list toolbar stuck across the top of a phone screen, and an info icon a little way under it
const STUCK_TOOLBAR = { left: 0, right: 390, top: 0, bottom: 120 }
const ICON = { left: 100, right: 113, top: 160, bottom: 173 } as DOMRect

/** An icon standing in for a tooltip's trigger, inside the given dialog or in no dialog at all */
function iconIn(dialog: object | null): HTMLElement {
  return { closest: (selector: string) => (selector === '[role="dialog"]' ? dialog : null) } as unknown as HTMLElement
}

describe('the bars a tooltip opening upwards keeps clear of', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubPageWithStuckToolbar() {
    vi.stubGlobal('document', {
      querySelectorAll: () => [{ contains: () => false, getBoundingClientRect: () => STUCK_TOOLBAR }],
    })
  }

  it('end at the stuck toolbar over a list row', () => {
    stubPageWithStuckToolbar()

    expect(getTooltipCoverBottom(iconIn(null), ICON)).toBe(STUCK_TOOLBAR.bottom)
  })

  it('leave out the page\'s toolbar for an icon in a dialog drawn over it', () => {
    stubPageWithStuckToolbar()

    expect(getTooltipCoverBottom(iconIn({}), ICON)).toBe(0)
  })
})
