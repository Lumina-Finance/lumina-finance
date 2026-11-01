/**
 * Tests what a click and a long press do to the average toggle, so keeping the average and stopping
 * keeping it cannot drift from what the issue describes
 */
import { describe, expect, it } from 'vitest'
import { getStateAfterClick, getStateAfterLongPress } from '@/pages/dashboard/utils/spendingAverageToggle'

describe('spending average toggle', () => {
  it('turns on and off with a click for this visit only, leaving a kept choice alone', () => {
    expect(getStateAfterClick({ on: false, kept: false })).toEqual({ on: true, kept: false })
    expect(getStateAfterClick({ on: true, kept: false })).toEqual({ on: false, kept: false })
    expect(getStateAfterClick({ on: true, kept: true })).toEqual({ on: false, kept: true })
  })

  it('keeps the average on with a long press, whether it was off or only on', () => {
    expect(getStateAfterLongPress({ on: false, kept: false }, true)).toEqual({ on: true, kept: true })
    expect(getStateAfterLongPress({ on: true, kept: false }, true)).toEqual({ on: true, kept: true })
  })

  it('stops keeping a kept toggle with a long press and leaves the visit as it is', () => {
    expect(getStateAfterLongPress({ on: true, kept: true }, true)).toEqual({ on: true, kept: false })
    expect(getStateAfterLongPress({ on: false, kept: true }, true)).toEqual({ on: false, kept: false })
  })

  it('turns on without keeping where the browser refused to save the choice', () => {
    expect(getStateAfterLongPress({ on: false, kept: false }, false)).toEqual({ on: true, kept: false })
  })
})
