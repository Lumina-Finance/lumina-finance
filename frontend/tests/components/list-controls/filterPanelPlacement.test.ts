/**
 * Tests the placement the open filter panel takes, so refactors catch it opening into a side with
 * no room, shrinking on a window that could hold it, or flipping direction under a scroll
 */
import { describe, expect, it } from 'vitest'
import { getFilterPanelPlacement } from '@/components/list-controls/filterPanelPlacement'

describe('filter panel placement', () => {
  it('grows and shrinks with content while retaining its minimum opening height', () => {
    const position = { anchorRect: { bottom: 100, top: 60 }, currentDirection: 'down' as const, viewportHeight: 1100 }
    expect(getFilterPanelPlacement({ ...position, contentHeight: 720 })).toEqual({ direction: 'down', height: 720 })
    expect(getFilterPanelPlacement({ ...position, contentHeight: 320 })).toEqual({ direction: 'down', height: 440 })
  })

  it('caps expanded content to available space and opens upward when it fits there', () => {
    expect(getFilterPanelPlacement({
      anchorRect: { bottom: 800, top: 760 }, currentDirection: 'down', viewportHeight: 1000, contentHeight: 700,
    })).toEqual({ direction: 'up', height: 700 })
    expect(getFilterPanelPlacement({
      anchorRect: { bottom: 100, top: 60 }, currentDirection: 'down', viewportHeight: 700, contentHeight: 900,
    })).toEqual({ direction: 'down', height: 576 })
  })

  it('opens downward when the space below the pill holds the full height', () => {
    expect(getFilterPanelPlacement({
      anchorRect: { bottom: 100, top: 60 },
      currentDirection: null,
      viewportHeight: 900,
    })).toEqual({ direction: 'down', height: 440 })
  })

  it('opens upward when only the space above the pill holds the full height', () => {
    expect(getFilterPanelPlacement({
      anchorRect: { bottom: 560, top: 520 },
      currentDirection: null,
      viewportHeight: 700,
    })).toEqual({ direction: 'up', height: 440 })
  })

  it('keeps the direction it is already open in while that side still fits', () => {
    // Both sides hold the panel here, so a scroll that makes below the roomier side must not flip
    // an already-open upward panel
    expect(getFilterPanelPlacement({
      anchorRect: { bottom: 640, top: 600 },
      currentDirection: 'up',
      viewportHeight: 1200,
    })).toEqual({ direction: 'up', height: 440 })
  })

  it('flips once the side it is open in stops fitting', () => {
    expect(getFilterPanelPlacement({
      anchorRect: { bottom: 140, top: 100 },
      currentDirection: 'up',
      viewportHeight: 900,
    })).toEqual({ direction: 'down', height: 440 })
  })

  it('shrinks into the roomier side when neither holds the full height', () => {
    expect(getFilterPanelPlacement({
      anchorRect: { bottom: 440, top: 400 },
      currentDirection: null,
      viewportHeight: 600,
    })).toEqual({ direction: 'up', height: 376 })

    expect(getFilterPanelPlacement({
      anchorRect: { bottom: 140, top: 100 },
      currentDirection: null,
      viewportHeight: 600,
    })).toEqual({ direction: 'down', height: 436 })
  })

  it('reports no height rather than a negative one when neither side has any room', () => {
    expect(getFilterPanelPlacement({
      anchorRect: { bottom: 45, top: 10 },
      currentDirection: null,
      viewportHeight: 50,
    })).toEqual({ direction: 'up', height: 0 })
  })

  it('holds the full height exactly at the viewport margin boundary', () => {
    expect(getFilterPanelPlacement({
      anchorRect: { bottom: 100, top: 60 },
      currentDirection: null,
      viewportHeight: 564,
    })).toEqual({ direction: 'down', height: 440 })

    expect(getFilterPanelPlacement({
      anchorRect: { bottom: 100, top: 60 },
      currentDirection: null,
      viewportHeight: 563,
    })).toEqual({ direction: 'down', height: 439 })

    expect(getFilterPanelPlacement({
      anchorRect: { bottom: 504, top: 464 },
      currentDirection: null,
      viewportHeight: 600,
    })).toEqual({ direction: 'up', height: 440 })
  })

})
