/**
 * Guards where a disabled control's reason appears. Under the pointer it is placed as the chart tooltips
 * are, from the pointer, and follows it. With no pointer, for keyboard focus or a tap, it is anchored near
 * the control's right edge and hangs clear below the control, or rises clear above it when there is no
 * room below, so it never lands on the control or on a field above it
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getReasonAnchor, getReasonBounds, isBoxInView } from '@/utils/disabledReasonAnchor'
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

describe('hint beside the control', () => {
  function placeHint(top: number) {
    const { box, origin } = buttonAt(top)
    const { clientX, clientY } = getReasonAnchor(box)
    const position = getCursorTooltipPosition({
      origin,
      tooltip: TOOLTIP,
      clientX,
      clientY,
      bounds: WINDOW,
      keepClear: box,
      preferAbove: true,
    })
    return { ...span(position), box }
  }

  it('rises clear above the control while there is room above it', () => {
    const { bottom, box } = placeHint(300)
    expect(bottom).toBeLessThanOrEqual(box.top)
  })

  it('hangs clear below the control when there is no room above it', () => {
    const { top, box } = placeHint(20)
    expect(top).toBeGreaterThanOrEqual(box.bottom)
  })
})

describe('disabled control reason bounds', () => {
  // A 1280 by 800 window with a dialogue body above a footer, the body's bottom edge 80px above the window's
  const body = rect(300, 100, 700, 620)
  const insideBody = { closest: () => ({ getBoundingClientRect: () => body }) } as unknown as HTMLElement
  const outsideBody = { closest: () => null } as unknown as HTMLElement

  // The tests run without a browser, so the window and the box constructor are stood in for
  function stubWindow() {
    vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800 })
    vi.stubGlobal('DOMRect', function (left: number, top: number, width: number, height: number) {
      return rect(left, top, width, height)
    })
  }

  afterEach(() => vi.unstubAllGlobals())

  it('is the window for a control outside any dialogue body', () => {
    stubWindow()
    expect(getReasonBounds(outsideBody)).toEqual(rect(0, 0, 1280, 800))
    expect(getReasonBounds(null)).toEqual(rect(0, 0, 1280, 800))
  })

  it('is the dialogue body for a control inside one, so a reason never reaches the footer or the rail', () => {
    stubWindow()
    expect(getReasonBounds(insideBody)).toEqual(body)
  })

  it('is the dialogue for a control in its footer, so a reason never leaves the dialogue', () => {
    stubWindow()
    const panel = rect(300, 60, 680, 680)
    const inFooter = {
      closest: (selector: string) =>
        selector.includes('[role="dialog"]') ? { getBoundingClientRect: () => panel } : null,
    } as unknown as HTMLElement
    expect(getReasonBounds(inFooter)).toEqual(panel)
  })

  it('is cut to the window where the body runs past it', () => {
    stubWindow()
    const tall = { closest: () => ({ getBoundingClientRect: () => rect(0, 100, 390, 900) }) } as unknown as HTMLElement
    expect(getReasonBounds(tall)).toEqual(rect(0, 100, 390, 700))
  })

  it('makes a control near the bottom of the body rise above itself', () => {
    stubWindow()
    const box = rect(500, 660, 280, 40)
    const origin = { getBoundingClientRect: () => box, closest: () => null } as unknown as HTMLElement
    const position = getCursorTooltipPosition({
      origin,
      tooltip: TOOLTIP,
      clientX: box.right,
      clientY: box.bottom,
      bounds: getReasonBounds(insideBody),
      keepClear: box,
    })
    expect(position.y + position.flipY + TOOLTIP.offsetHeight).toBeLessThanOrEqual(box.top)
  })
})
