/**
 * Tests dropdown positioning math so refactors catch menus opening off-screen, clipping against viewport padding, or shrinking searchable lists incorrectly
 */
import { describe, expect, it } from 'vitest'
import { getDropdownListPosition } from '@/components/dropdown/dropdownPosition'

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
      left: 20,
      listMaxHeight: 336,
      menuMaxHeight: 336,
      top: 146,
      width: 200,
    })
  })

  it('opens above the trigger and reserves search height when the lower viewport is constrained', () => {
    expect(getDropdownListPosition({
      anchorRect: { bottom: 560, left: 20, top: 520, width: 200 },
      searchable: true,
      viewport,
    })).toEqual({
      left: 20,
      listMaxHeight: 280,
      menuMaxHeight: 336,
      top: 178,
      width: 200,
    })
  })

  it('keeps the menu inside horizontal viewport padding', () => {
    expect(getDropdownListPosition({
      anchorRect: { bottom: 140, left: -20, top: 100, width: 200 },
      searchable: false,
      viewport: { ...viewport, width: 300 },
    }).left).toBe(12)

    expect(getDropdownListPosition({
      anchorRect: { bottom: 140, left: 250, top: 100, width: 100 },
      searchable: false,
      viewport: { ...viewport, width: 300 },
    }).left).toBe(188)
  })
})

