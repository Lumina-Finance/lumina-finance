/**
 * Tests how far the bottom-right message moves up to leave an element it must not cover, so a
 * rewrite catches a message that hides the Commit import button after an undo, and one that moves
 * when nothing is under it
 */
import { describe, expect, it } from 'vitest'
import { getToastLift } from '@/components/feedback/toastLift'

// The message at 1280x800 after an undo: 384 wide and 98 tall, 20px from the corner
const toast = { left: 876, right: 1260, top: 682, bottom: 780 }

describe('getToastLift', () => {
  it('moves up to sit above the commit footer it would cover', () => {
    const footer = { left: 400, right: 1260, top: 700, bottom: 780 }

    // Its bottom lands 12px above the footer's top
    expect(getToastLift(toast, [footer])).toBe(780 - (700 - 12))
  })

  it('stays where it is when nothing marked is under it', () => {
    expect(getToastLift(toast, [])).toBe(0)
    // Above it, below it and beside it
    expect(getToastLift(toast, [{ left: 400, right: 1260, top: 100, bottom: 200 }])).toBe(0)
    expect(getToastLift(toast, [{ left: 400, right: 1260, top: 790, bottom: 870 }])).toBe(0)
    expect(getToastLift(toast, [{ left: 100, right: 800, top: 700, bottom: 780 }])).toBe(0)
  })

  it('moves on when moving up lands on another marked element', () => {
    const footer = { left: 400, right: 1260, top: 700, bottom: 780 }
    const above = { left: 400, right: 1260, top: 560, bottom: 640 }

    // Clear of the upper one too, which sits 560 down
    expect(getToastLift(toast, [footer, above])).toBe(780 - (560 - 12))
  })

  it('never leaves the top of the window', () => {
    const footer = { left: 0, right: 1260, top: 20, bottom: 780 }

    expect(getToastLift(toast, [footer])).toBe(682 - 8)
  })
})
