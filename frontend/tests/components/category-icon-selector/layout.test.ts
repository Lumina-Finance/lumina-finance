/**
 * Guards the emoji picker panel's sizing: its height follows what it holds up to the Dropdown's own
 * greatest, so a search with few results no longer leaves a blank band under them, and its width is
 * exactly the grid plus the scrollbar's room on both sides, so the sides stay even
 */
import { describe, expect, it } from 'vitest'
import {
  EMOJI_PICKER_GRID_WIDTH,
  getEmojiPickerPanelHeight,
  getEmojiPickerPlacement,
  getEmojiPickerWidth,
  type EmojiPickerViewport,
} from '@/components/category-icon-selector/layout'
import { DROPDOWN_BOX_CHROME } from '@/components/dropdown/position'

const VIEWPORT: EmojiPickerViewport = { height: 800, layoutHeight: 800, offsetLeft: 0, offsetTop: 0, width: 1280 }

describe('getEmojiPickerWidth', () => {
  it('is the grid, a scrollbar gutter either side, and the panel padding and border', () => {
    expect(getEmojiPickerWidth(10, 1280)).toBe(EMOJI_PICKER_GRID_WIDTH + 20 + DROPDOWN_BOX_CHROME)
  })

  it('is no wider than the grid where scrollbars float over the content', () => {
    expect(getEmojiPickerWidth(0, 1280)).toBe(EMOJI_PICKER_GRID_WIDTH + DROPDOWN_BOX_CHROME)
  })

  it('leaves the screen its margin on a narrow viewport', () => {
    expect(getEmojiPickerWidth(10, 250)).toBe(250 - 24)
  })
})

describe('getEmojiPickerPanelHeight', () => {
  it('shrinks to a few results plus the panel chrome', () => {
    expect(getEmojiPickerPanelHeight(150, 400)).toBe(150 + DROPDOWN_BOX_CHROME)
  })

  it('rounds a fractional content height up so the last row is never clipped', () => {
    expect(getEmojiPickerPanelHeight(150.2, 400)).toBe(151 + DROPDOWN_BOX_CHROME)
  })

  it('stops at the greatest height, which the contents scroll inside', () => {
    expect(getEmojiPickerPanelHeight(7922, 400)).toBe(400)
  })
})

describe('getEmojiPickerPlacement', () => {
  it('opens below the button and pins its upper edge when there is room', () => {
    const placement = getEmojiPickerPlacement({
      anchorRect: { bottom: 200, top: 160 },
      preferredLeft: 100,
      viewport: VIEWPORT,
      width: 262,
    })
    expect(placement).toMatchObject({ bottom: undefined, openAbove: false, top: 208, left: 100 })
    expect(placement.maxHeight).toBe(400)
  })

  it('opens above and pins its lower edge, so a shrinking panel closes in on the button', () => {
    const placement = getEmojiPickerPlacement({
      anchorRect: { bottom: 760, top: 720 },
      preferredLeft: 100,
      viewport: VIEWPORT,
      width: 262,
    })
    expect(placement).toMatchObject({ openAbove: true, top: undefined })
    // The lower edge sits an 8px gap above the button, however tall the panel is
    expect(800 - placement.bottom!).toBe(712)
  })

  it('never lets the greatest height leave the top of the screen when opening above', () => {
    const placement = getEmojiPickerPlacement({
      anchorRect: { bottom: 260, top: 220 },
      preferredLeft: 100,
      viewport: { ...VIEWPORT, height: 300, layoutHeight: 300 },
      width: 262,
    })
    expect(placement.openAbove).toBe(true)
    expect(300 - placement.bottom! - placement.maxHeight).toBeGreaterThanOrEqual(12)
  })

  it('keeps the panel inside the right edge of the screen', () => {
    const placement = getEmojiPickerPlacement({
      anchorRect: { bottom: 200, top: 160 },
      preferredLeft: 1200,
      viewport: VIEWPORT,
      width: 262,
    })
    expect(placement.left).toBe(1280 - 262 - 12)
  })
})
