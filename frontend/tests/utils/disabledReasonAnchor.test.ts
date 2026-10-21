/**
 * Guards where a disabled control's reason appears. Shown for keyboard focus or a tap, with no pointer to
 * follow, it ends at the control's right edge. Under the pointer, or from either of those, it must never
 * sit on the control itself, which hid the button's label: it rises clear above the control, or hangs
 * clear below it when there is no room above, and still follows the pointer sideways
 */
import { describe, expect, it } from 'vitest'
import { getReasonAnchor } from '@/utils/disabledReasonAnchor'
import { getCursorTooltipPosition } from '@/utils/tooltipPosition'

// A 40px high button in a 1280 by 800 window, with a reason 36px high and 200px wide
const TOOLTIP = { offsetWidth: 200, offsetHeight: 36 } as HTMLElement

/** A box as the browser reports it, written out since the tests run without a browser */
function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height } as DOMRect
}

const WINDOW = rect(0, 0, 1280, 800)

function buttonAt(top: number) {
  const box = rect(500, top, 280, 40)
  return { box, origin: { getBoundingClientRect: () => box, closest: () => null } as unknown as HTMLElement }
}

function place(top: number, clientX: number, clientY: number) {
  const { box, origin } = buttonAt(top)
  const position = getCursorTooltipPosition({ origin, tooltip: TOOLTIP, clientX, clientY, bounds: WINDOW, keepClear: box })
  // Where the tooltip's top and bottom land, which the vertical follow and the flip add up to
  const top_ = position.y + position.flipY
  return { ...position, top: top_, bottom: top_ + TOOLTIP.offsetHeight, box }
}

describe('disabled control reason anchor', () => {
  it('ends at the control right edge, from its top', () => {
    expect(getReasonAnchor({ right: 300, top: 200 })).toEqual({ clientX: 300, clientY: 200 })
  })
})

describe('disabled control reason placement', () => {
  it('rises clear above the control while the pointer is in the middle of it', () => {
    const { bottom, box } = place(600, 640, 620)
    expect(bottom).toBeLessThanOrEqual(box.top)
  })

  it('hangs clear below the control when there is no room above it', () => {
    const { top, box } = place(20, 640, 40)
    expect(top).toBeGreaterThanOrEqual(box.bottom)
  })

  it('still follows the pointer sideways', () => {
    expect(place(600, 700, 620).x).toBeGreaterThan(place(600, 560, 620).x)
  })
})
