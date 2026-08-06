/**
 * Tests where the open drop-down sits, how much of it the option list gets and how wide it opens,
 * so a change catches a box growing off the screen, a head that shifts as the box opens, or a list
 * clipped by its own box
 */
import { describe, expect, it } from 'vitest'
import { getDropdownBoxPosition } from '@/components/dropdown/position'

const viewport = {
  height: 600,
  layoutHeight: 600,
  offsetLeft: 0,
  offsetTop: 0,
  width: 800,
}

const head = { headHeight: 40, searchable: false }

describe('drop-down box placement', () => {
  it('pins the box by the head’s upper edge when the list grows downward', () => {
    expect(getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: 20, top: 100, width: 200 },
      viewport,
    })).toEqual({
      bottom: 460,
      boxMaxHeight: 400,
      left: 20,
      listMaxHeight: 346,
      openAbove: false,
      openWidth: 320,
      top: 100,
      width: 200,
    })
  })

  it('pins the box by the head’s lower edge when the list grows upward', () => {
    const position = getDropdownBoxPosition({
      ...head,
      searchable: true,
      anchorRect: { bottom: 560, left: 20, top: 520, width: 200 },
      viewport,
    })

    // 40px of room below the head is not worth opening into, so it opens up instead, and the head
    // stays exactly where it was: its lower edge is 40px off the bottom of the page either way
    expect(position.openAbove).toBe(true)
    expect(position.bottom).toBe(40)
    expect(position.listMaxHeight).toBe(290)
  })

  it('never gives the box more height than the room it actually has', () => {
    // A field low on a short screen, with too little room below to open into and not much above
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 190, left: 20, top: 150, width: 200 },
      viewport: { height: 200, layoutHeight: 200, offsetLeft: 0, offsetTop: 0, width: 390 },
    })

    expect(position.openAbove).toBe(true)
    expect(position.boxMaxHeight).toBe(178)

    // Upper edge of the box, which has to stay on screen or its top rows are clipped unreachably
    expect(200 - position.bottom - position.boxMaxHeight).toBeGreaterThanOrEqual(12)
  })

  it('measures the upward pin against the layout viewport, not the part a raised keyboard leaves visible', () => {
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 470, left: 20, top: 430, width: 200 },
      viewport: { height: 400, layoutHeight: 800, offsetLeft: 0, offsetTop: 100, width: 390 },
    })

    // A fixed box measures its own lower edge against the full page, so taking it from the visible
    // part instead would drop the head 300px below where the field actually sits
    expect(position.openAbove).toBe(true)
    expect(800 - position.bottom).toBe(470)
  })

  it('leaves the list what is left after the head, the search field and the box’s own edges', () => {
    const withoutSearch = getDropdownBoxPosition({ ...head, anchorRect: { bottom: 140, left: 20, top: 100, width: 200 }, viewport })
    const withSearch = getDropdownBoxPosition({ ...head, searchable: true, anchorRect: { bottom: 140, left: 20, top: 100, width: 200 }, viewport })

    // 400 of box, less a 40 head and 14 of border and padding
    expect(withoutSearch.listMaxHeight).toBe(346)

    // and less another 56 once a search field sits above the list
    expect(withSearch.listMaxHeight).toBe(290)
  })

  it('gives a shorter head more list, since they share one box', () => {
    const compact = getDropdownBoxPosition({
      ...head,
      headHeight: 36,
      anchorRect: { bottom: 136, left: 20, top: 100, width: 200 },
      viewport,
    })

    expect(compact.listMaxHeight).toBe(350)
  })

  it('keeps the box inside horizontal viewport padding', () => {
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: -20, top: 100, width: 200 },
      viewport: { ...viewport, width: 300 },
    })

    expect(position.left).toBe(12)
    expect(position.openWidth).toBe(276)
  })

  it('leaves the head where it is when the box is free to grow', () => {
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: 150, top: 100, width: 100 },
      viewport: { ...viewport, width: 300 },
    })

    // The head and the list are one box, so the placement is worked out from the closed width and
    // the growing happens on the far side of it. Anything else slides the head sideways at the
    // moment the user opened it
    expect(position.width).toBe(100)
    expect(position.left).toBe(150)
    expect(position.openWidth).toBe(138)
  })

  it('pulls the box back on screen only when its slot is hanging off the edge', () => {
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: 250, top: 100, width: 100 },
      viewport: { ...viewport, width: 300 },
    })

    // Pulled back to sit inside the padding, and then given no room to grow, so a box that had to
    // be moved on screen does not spend the move growing off it again
    expect(position.left).toBe(188)
    expect(position.openWidth).toBe(100)
  })

  it('stops the box at the padding when it opens near the right edge', () => {
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: 600, top: 100, width: 150 },
      viewport,
    })

    expect(position.left).toBe(600)
    expect(position.openWidth).toBe(188)

    // The far side of a box grown as wide as it may be, which is exactly the padding off the edge
    expect(position.left + position.openWidth).toBe(788)
  })

  it('never grows a slot that is already wider than the maximum', () => {
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: 20, top: 100, width: 480 },
      viewport,
    })

    // The open width is the slot's own, which is how a full-width field opens exactly as wide as
    // it sits and never moves at all
    expect(position.openWidth).toBe(480)
    expect(position.width).toBe(480)
  })

  it('measures the room to grow into from the part of the page that is on screen', () => {
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: 150, top: 100, width: 100 },
      viewport: { height: 600, layoutHeight: 600, offsetLeft: 100, offsetTop: 0, width: 300 },
    })

    // A phone pinched and panned sideways, where the visible part starts 100px in. Taken from the
    // width alone the box would be held to 138 and lose 100px of room it actually has
    expect(position.openWidth).toBe(238)
  })

  it('keeps the closed width when the screen is narrower than the slot itself', () => {
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: 0, top: 100, width: 200 },
      viewport: { ...viewport, width: 150 },
    })

    // 138 of room for a 200 slot, so there is nothing to grow into and nothing to gain by taking
    // the box in narrower than the head inside it
    expect(position.left).toBe(0)
    expect(position.openWidth).toBe(200)
  })

  it('grows a narrow control on a phone and leaves a full-width field alone', () => {
    const phone = { height: 800, layoutHeight: 800, offsetLeft: 0, offsetTop: 0, width: 390 }

    const field = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: 16, top: 100, width: 358 },
      viewport: phone,
    })
    const compact = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: 16, top: 100, width: 120 },
      viewport: phone,
    })

    expect(field.openWidth).toBe(358)
    expect(compact.openWidth).toBe(320)

    // Still 54px short of the far edge, so a grown box on a phone is nowhere near it
    expect(390 - (compact.left + compact.openWidth)).toBe(54)
  })
})
