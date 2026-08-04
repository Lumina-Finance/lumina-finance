/**
 * Tests dropdown positioning math so refactors catch menus opening off-screen, clipping against viewport padding, or shrinking searchable lists incorrectly
 */
import { describe, expect, it } from 'vitest'
import { getDropdownListPosition } from '@/components/dropdown/position'

const viewport = {
  height: 600,
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
      bottom: 506,
      left: 20,
      listMaxHeight: 336,
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
      listMaxHeight: 280,
      menuMaxHeight: 336,
      openAbove: true,
      top: 178,
      width: 208,
    })
  })

  it('pins a panel opening upward six pixels above the trigger, so its height grows away from the field', () => {
    const position = getDropdownListPosition({
      anchorRect: { bottom: 560, left: 20, top: 520, width: 200 },
      searchable: false,
      viewport,
    })

    // The trigger's top edge sits 80px off the bottom of the viewport, and the panel stops short of it
    expect(position.openAbove).toBe(true)
    expect(position.bottom).toBe(86)
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
