/**
 * Guards where a disabled control's reason appears. Under the pointer it is placed as the chart tooltips
 * are, from the pointer, and follows it. With no pointer, for keyboard focus or a tap, it is anchored near
 * the control's right edge and hangs clear below the control, or rises clear above it when there is no
 * room below, so it never lands on the control or on a field above it
 */
import { describe, expect, it } from 'vitest'
import { getReasonAnchor, isBoxInView } from '@/utils/disabledReasonAnchor'
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

/** Where the tooltip's top and bottom land, which the vertical follow and the flip add up to */
function span(position: { y: number; flipY: number }) {
  const top = position.y + position.flipY
  return { top, bottom: top + TOOLTIP.offsetHeight }
}

function placeUnderPointer(clientX: number, clientY: number) {
  const { origin } = buttonAt(600)
  return getCursorTooltipPosition({ origin, tooltip: TOOLTIP, clientX, clientY, bounds: WINDOW })
}

function placeBeside(top: number) {
  const { box, origin } = buttonAt(top)
  const { clientX, clientY } = getReasonAnchor(box)
  const position = getCursorTooltipPosition({
    origin,
    tooltip: TOOLTIP,
    clientX,
    clientY,
    bounds: WINDOW,
    keepClear: box,
  })
  return { ...position, ...span(position), box }
}

describe('disabled control reason anchor', () => {
  it('ends at the control right edge, from its bottom', () => {
    expect(getReasonAnchor({ right: 300, bottom: 240 })).toEqual({ clientX: 300, clientY: 240 })
  })
})

describe('disabled control in view', () => {
  // A dialogue body 300px high that sits inside the window
  const body = rect(100, 100, 600, 300)

  it('is in view while any part of it is inside every box that clips it', () => {
    expect(isBoxInView(rect(500, 360, 280, 40), [WINDOW, body])).toBe(true)
    expect(isBoxInView(rect(500, 380, 280, 40), [WINDOW, body])).toBe(true)
  })

  it('is out of view once the body has scrolled it past the body edge, though the window still shows it', () => {
    expect(isBoxInView(rect(500, 400, 280, 40), [WINDOW, body])).toBe(false)
    expect(isBoxInView(rect(500, 40, 280, 40), [WINDOW, body])).toBe(false)
  })

  it('is out of view when the window does not show it', () => {
    expect(isBoxInView(rect(500, 800, 280, 40), [WINDOW])).toBe(false)
  })
})

describe('disabled control reason under the pointer', () => {
  it('follows the pointer in both directions', () => {
    const first = placeUnderPointer(560, 610)
    const second = placeUnderPointer(700, 625)
    expect(second.x).toBeGreaterThan(first.x)
    expect(second.y).toBeGreaterThan(first.y)
  })
})

describe('disabled control reason beside the control', () => {
  it('hangs clear below the control', () => {
    const { top, box } = placeBeside(300)
    expect(top).toBeGreaterThanOrEqual(box.bottom)
  })

  it('rises clear above the control when there is no room below it', () => {
    const { bottom, box } = placeBeside(750)
    expect(bottom).toBeLessThanOrEqual(box.top)
  })

  it('ends level with the control right edge', () => {
    const { x, box } = placeBeside(300)
    expect(x + TOOLTIP.offsetWidth).toBe(box.right)
  })
})
