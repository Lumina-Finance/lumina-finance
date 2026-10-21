/**
 * Guards where a disabled control's reason appears. Shown for keyboard focus or a tap, with no pointer to
 * follow, it ends at the control's right edge. Under the pointer, or from either of those, it must never
 * sit on the control itself, which hid the button's label: it rises clear above the control, or hangs
 * clear below it when there is no room above, and still follows the pointer sideways
 */
import { describe, expect, it } from 'vitest'
import { getReasonAnchor, getReasonKeepClear } from '@/utils/disabledReasonAnchor'
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

describe('disabled control keep-clear box', () => {
  it('takes in the label that names the control, so a reason rising above it never covers the label', () => {
    const label = { getBoundingClientRect: () => rect(500, 460, 120, 20) }
    const control = {
      getBoundingClientRect: () => rect(500, 490, 280, 40),
      getAttribute: () => 'field-label',
      ownerDocument: { getElementById: () => label },
    } as unknown as HTMLElement

    const box = getReasonKeepClear(control)
    expect([box.left, box.top, box.right, box.bottom]).toEqual([500, 460, 780, 530])
  })

  it('finds the label through the control labels and the first of several ids', () => {
    const label = { getBoundingClientRect: () => rect(500, 460, 120, 20) }
    const byLabels = {
      getBoundingClientRect: () => rect(500, 490, 280, 40),
      getAttribute: () => null,
      labels: [label],
    } as unknown as HTMLElement
    const byIds = {
      getBoundingClientRect: () => rect(500, 490, 280, 40),
      getAttribute: () => ' first-label second-label ',
      ownerDocument: { getElementById: (id: string) => (id === 'first-label' ? label : null) },
    } as unknown as HTMLElement

    expect(getReasonKeepClear(byLabels).top).toBe(460)
    expect(getReasonKeepClear(byIds).top).toBe(460)
  })

  it('reaches a label up to 24px from the control and ignores one further off', () => {
    // The control spans 490 to 530, and a label 20px high ends 24px above it, or 25px above it
    const near = { getBoundingClientRect: () => rect(500, 446, 120, 20) }
    const far = { getBoundingClientRect: () => rect(500, 445, 120, 20) }
    const withLabel = (label: unknown) => ({
      getBoundingClientRect: () => rect(500, 490, 280, 40),
      getAttribute: () => null,
      labels: [label],
    }) as unknown as HTMLElement

    expect(getReasonKeepClear(withLabel(near)).top).toBe(446)
    expect(getReasonKeepClear(withLabel(far)).top).toBe(490)
  })

  it('takes in a label below the control down to its bottom edge', () => {
    const below = { getBoundingClientRect: () => rect(500, 536, 120, 20) }
    const control = {
      getBoundingClientRect: () => rect(500, 490, 280, 40),
      getAttribute: () => null,
      labels: [below],
    } as unknown as HTMLElement

    const box = getReasonKeepClear(control)
    expect([box.top, box.bottom]).toEqual([490, 556])
  })

  it('falls back to the control labels when the named id is not on the page', () => {
    const label = { getBoundingClientRect: () => rect(500, 460, 120, 20) }
    const control = {
      getBoundingClientRect: () => rect(500, 490, 280, 40),
      getAttribute: () => 'missing-label',
      ownerDocument: { getElementById: () => null },
      labels: [label],
    } as unknown as HTMLElement

    expect(getReasonKeepClear(control).top).toBe(460)
  })

  it('is the control box when nothing names it', () => {
    const control = {
      getBoundingClientRect: () => rect(500, 490, 280, 40),
      getAttribute: () => null,
      labels: null,
    } as unknown as HTMLElement

    const box = getReasonKeepClear(control)
    expect([box.left, box.top, box.right, box.bottom]).toEqual([500, 490, 780, 530])
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
