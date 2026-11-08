/**
 * Covers where an icon's tooltip opens and the bars it keeps clear of
 *
 * These tests catch the page's stuck bars pushing a tooltip in a dialogue below its icon, when the
 * dialogue is drawn over those bars, and an icon's tooltip in a dialogue's narrow column pushed out of the
 * column, where it is cut off, to clear the sidebar's edge behind the dialogue, or one in a card kept
 * clear of the sidebar alone and left reaching past the card's left side. Last, they catch an icon's
 * tooltip covering the value of the fact it explains when it has no room on its preferred side, and one
 * beside no fact leaving the side it prefers when the other has no room either
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getIconTooltipOffset,
  getIconTooltipPlacement,
  getIconTooltipSide,
  getTooltipCoverBottom,
} from '@/utils/tooltipPosition'

describe('the sideways shift of an icon’s tooltip', () => {
  // A 1280px screen with the sidebar expanded, and a tooltip as wide as a long note makes it
  const sidebarEdge = { page: { left: 260, right: 1280 }, screenWidth: 1280 }
  const tooltipWidth = 224

  it('keeps clear of the sidebar where the surface around the icon leaves room', () => {
    // An icon near the left of a dialogue's wide body. The body lies across the sidebar's edge behind it
    const offset = getIconTooltipOffset({
      icon: { left: 294, width: 12 },
      tooltipWidth,
      surface: { left: 189, right: 861 },
      ...sidebarEdge,
    })

    // Centred it would start at 188, so it starts at the sidebar's edge and the margin instead
    expect(offset).toBe(80)
  })

  it('stays inside a narrow column lying across the sidebar’s edge when asked, rather than clearing that edge', () => {
    const offset = getIconTooltipOffset({
      icon: { left: 310, width: 12 },
      tooltipWidth,
      surface: { left: 160, right: 448 },
      staysInSurface: true,
      ...sidebarEdge,
    })

    // Centred it would start at 204, and held right of the sidebar's edge at 268 it would end at 492,
    // past the column's 440. It goes only as far right as the column leaves room for
    expect(offset).toBe(12)
  })

  it('clears the sidebar’s edge in that column unless asked to stay inside it', () => {
    const offset = getIconTooltipOffset({
      icon: { left: 310, width: 12 },
      tooltipWidth,
      surface: { left: 160, right: 448 },
      ...sidebarEdge,
    })

    expect(offset).toBe(64)
  })

  it('keeps clear of the sidebar with no surface around the icon', () => {
    // An icon just past the sidebar's edge, where centred it would start at 164
    expect(getIconTooltipOffset({ icon: { left: 270, width: 12 }, tooltipWidth, ...sidebarEdge })).toBe(104)
  })

  it('stays inside a card that starts right of the sidebar’s edge', () => {
    // An icon near the left of a card in the page, where centred it would start at 304, clear of the
    // sidebar's edge but left of the card's 408
    const offset = getIconTooltipOffset({
      icon: { left: 410, width: 12 },
      tooltipWidth,
      surface: { left: 400, right: 800 },
      ...sidebarEdge,
    })

    expect(offset).toBe(104)
  })
})

describe('the side an icon’s tooltip opens on', () => {
  // A fact whose label carries the icon and whose value sits under it, in a surface 600px tall on an
  // 800px screen, with a tooltip 190px tall that prefers to open above
  const screen = { preferred: 'top', tooltipHeight: 190, coverBottom: 0, screenHeight: 800 } as const
  const surface = { top: 0, bottom: 600 }
  const factAt = (top: number) => ({ icon: { top: top + 2, bottom: top + 14 }, subject: { top, bottom: top + 38 } })

  it('keeps to the preferred side, above the whole fact, where it fits', () => {
    expect(getIconTooltipPlacement({ ...screen, ...factAt(300), surface })).toEqual({ placement: 'top', shift: -2 })
  })

  it('opens below the whole fact, clear of its value, where there is no room above', () => {
    expect(getIconTooltipPlacement({ ...screen, ...factAt(100), surface })).toEqual({ placement: 'bottom', shift: 24 })
  })

  it('opens below the whole fact even where the surface leaves no room below either', () => {
    expect(getIconTooltipPlacement({ ...screen, ...factAt(100), surface: { top: 0, bottom: 300 } })).toEqual({
      placement: 'bottom',
      shift: 24,
    })
  })

  it('keeps to the preferred side, from the icon, without a fact around it where neither side fits', () => {
    const { icon } = factAt(100)

    expect(getIconTooltipPlacement({ ...screen, icon, surface: { top: 0, bottom: 300 } })).toEqual({
      placement: 'top',
      shift: 0,
    })
  })
})

// A list toolbar stuck across the top of a phone screen, and an info icon a little way under it
const STUCK_TOOLBAR = { left: 0, right: 390, top: 0, bottom: 120 }
const ICON = { left: 100, right: 113, top: 160, bottom: 173 } as DOMRect

/** An icon standing in for a tooltip's trigger, inside the given dialogue or in no dialogue at all */
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

  it("leave out the page's toolbar for an icon in a dialog drawn over it", () => {
    stubPageWithStuckToolbar()

    expect(getTooltipCoverBottom(iconIn({}), ICON)).toBe(0)
  })
})

describe('the side an icon’s tooltip opens on beside a stuck list bar', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // The icon sits 160px down with 100px of tooltip above it, which fits over the page but not over the
  // 120px toolbar stuck across the top
  function sideOf(clearsStickyBars?: boolean) {
    vi.stubGlobal('window', { innerHeight: 800 })
    vi.stubGlobal('document', {
      querySelectorAll: () => [{ contains: () => false, getBoundingClientRect: () => STUCK_TOOLBAR }],
    })
    const trigger = { getBoundingClientRect: () => ICON, closest: () => null } as unknown as HTMLElement
    const tooltip = { getBoundingClientRect: () => ({ height: 100 }) } as unknown as HTMLElement
    return getIconTooltipSide({ trigger, tooltip, preferred: 'top', sideBoundary: 'viewport', clearsStickyBars })
  }

  it('opens upwards over the bar unless the icon asks to clear it', () => {
    expect(sideOf()).toEqual({ placement: 'top', shift: 0 })
  })

  it('opens below the icon when it asks to clear the bar', () => {
    expect(sideOf(true)).toEqual({ placement: 'bottom', shift: 0 })
  })
})
