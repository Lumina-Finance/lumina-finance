/**
 * Tests dropdown positioning math so refactors catch menus opening off-screen, clipping against viewport padding, or shrinking searchable lists incorrectly
 */
import { describe, expect, it } from 'vitest'
import { getDropdownListPosition } from '@/components/dropdown/position'

const viewport = {
  height: 600,
  layoutHeight: 600,
  offsetLeft: 0,
  offsetTop: 0,
  width: 800,
}

describe('dropdown positioning', () => {
  it('opens below the trigger when there is enough viewport space', () => {
    expect(getDropdownListPosition({
      anchorRect: { bottom: 140, left: 20, top: 100, width: 200 },
      searchable: false,
      viewport,
    })).toEqual({
      bottom: 252,
      left: 20,
      listMaxHeight: 322,
      menuMaxHeight: 336,
      openAbove: false,
      top: 146,
      width: 208,
    })
  })

  it('opens above the trigger and reserves search height when the lower viewport is constrained', () => {
    expect(getDropdownListPosition({
      anchorRect: { bottom: 560, left: 20, top: 520, width: 200 },
      searchable: true,
      viewport,
    })).toEqual({
      bottom: 86,
      left: 20,
      listMaxHeight: 266,
      menuMaxHeight: 336,
      openAbove: true,
      top: 178,
      width: 208,
    })
  })

  it('leaves the list room for the panel border and padding, so its last option is not clipped', () => {
    const position = getDropdownListPosition({
      anchorRect: { bottom: 140, left: 20, top: 100, width: 200 },
      searchable: false,
      viewport,
    })

    // The panel spends 1px of border and 6px of padding at each end before the list gets any height
    expect(position.menuMaxHeight - position.listMaxHeight).toBe(14)
  })

  it('holds an upward panel inside the viewport when the space above the trigger is short', () => {
    const shortViewport = { height: 320, layoutHeight: 320, offsetLeft: 0, offsetTop: 0, width: 390 }
    const position = getDropdownListPosition({
      anchorRect: { bottom: 190, left: 20, top: 150, width: 200 },
      searchable: false,
      viewport: shortViewport,
    })

    // Only 132px sits above the trigger but the panel is held to a 160px minimum, so pinning it a
    // gap above the trigger would put its upper edge 16px off the top of the screen, where the
    // panel's own clipping puts those rows out of reach
    expect(position.openAbove).toBe(true)
    expect(shortViewport.layoutHeight - position.bottom - position.menuMaxHeight)
      .toBeGreaterThanOrEqual(12)
  })

  it('measures an upward panel against the layout viewport, not the part a raised keyboard leaves visible', () => {
    const position = getDropdownListPosition({
      anchorRect: { bottom: 470, left: 20, top: 430, width: 200 },
      searchable: false,
      viewport: { height: 400, layoutHeight: 800, offsetLeft: 0, offsetTop: 100, width: 390 },
    })

    // A fixed panel measures its own lower edge against the full page, so taking it from the visible
    // part instead would drop the panel 300px below the field it belongs to
    expect(position.openAbove).toBe(true)
    expect(800 - position.bottom).toBe(430 - 6)
  })

  it('keeps the menu inside horizontal viewport padding', () => {
    expect(getDropdownListPosition({
      anchorRect: { bottom: 140, left: -20, top: 100, width: 200 },
      searchable: false,
      viewport: { ...viewport, width: 300 },
    }).left).toBe(12)
  })

  it('widens a panel over a narrow trigger and clamps on the widened panel', () => {
    const position = getDropdownListPosition({
      anchorRect: { bottom: 140, left: 250, top: 100, width: 100 },
      searchable: false,
      viewport: { ...viewport, width: 300 },
    })

    // A 100px pill in a table cell would open a panel too narrow to read, so it widens to the
    // minimum and is pushed back inside the viewport instead of hanging off the right edge
    expect(position.width).toBe(208)
    expect(position.left).toBe(80)
  })
})
