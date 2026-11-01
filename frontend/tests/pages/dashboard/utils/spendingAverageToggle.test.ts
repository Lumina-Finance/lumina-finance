/**
 * Tests what a click and a long press do to the average toggle, so keeping the average and stopping
 * keeping it cannot drift from what the issue describes
 */
import { describe, expect, it } from 'vitest'
import {
  AVERAGE_FAILED_MESSAGE,
  getAverageToggleTexts,
  getStateAfterClick,
  getStateAfterLongPress,
} from '@/pages/dashboard/utils/spendingAverageToggle'

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

  it.each([
    ['WTD', 'week', 12],
    ['MTD', 'month', 12],
    ['QTD', 'quarter', 4],
    ['YTD', 'year', 3],
  ] as const)('says what a click and a hold do and how the %s average is worked out', (range, unit, limit) => {
    const worked = `The average is calculated from the last ${limit} ${unit}s, leaving out any without spending.`
    expect(getAverageToggleTexts(false, range).tooltip).toBe(
      `Click to compare with your average ${unit}, and hold to use it as the default. ${worked}`,
    )
    expect(getAverageToggleTexts(true, range).tooltip).toBe(
      `Click to compare with your average ${unit}, and hold to stop using it as the default. ${worked}`,
    )
  })

  it('says the average could not load and that a click tries again, in the tooltip and the toast', () => {
    expect(getAverageToggleTexts(false, 'MTD', true).tooltip).toBe("Your average couldn't load. Click to try again.")
    expect(AVERAGE_FAILED_MESSAGE).toBe("Your average couldn't load. Click AVG to try again.")
  })

  it('names the toggle by what it does, and says when it is kept', () => {
    expect(getAverageToggleTexts(false, 'MTD').name).toBe('Compare with your average')
    expect(getAverageToggleTexts(true, 'MTD').name).toBe('Compare with your average, kept on')
  })
})
