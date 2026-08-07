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
  layoutWidth: 800,
  offsetLeft: 0,
  offsetTop: 0,
  width: 800,
}

const head = { headHeight: 40, held: null, searchable: false }

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
      openLeftward: false,
      openWidth: 320,
      right: 580,
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

    // 68px of room below the head cannot hold the box and 548 above it can, so it opens up, and the
    // head stays exactly where it was: its lower edge is 40px off the bottom of the page either way
    expect(position.openAbove).toBe(true)
    expect(position.bottom).toBe(40)
    expect(position.listMaxHeight).toBe(304)
  })

  it('opens upward while there is still room below, once the room above beats it', () => {
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 480, left: 20, top: 440, width: 200 },
      viewport: { ...viewport, height: 900, layoutHeight: 900 },
    })

    // 448 below is enough to hold the whole 400 box, so the box would fit either way. It goes up
    // anyway, because 468 above is more, and a box that only just fits ends against the bottom of
    // the screen with nothing under it
    expect(position.openAbove).toBe(true)
    expect(position.boxMaxHeight).toBe(400)
  })

  it('opens upward when neither side can hold the box and there is more room above', () => {
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 340, left: 20, top: 300, width: 200 },
      viewport,
    })

    // 288 below against 328 above, so it takes the roomier side and gets 40px more list than it
    // would have opening downward out of habit
    expect(position.openAbove).toBe(true)
    expect(position.boxMaxHeight).toBe(328)
  })

  it('keeps the way an open box is already growing while the page moves under it', () => {
    const anchorRect = { bottom: 140, left: 20, top: 100, width: 200 }

    // Geometry that would be chosen downward and rightward from cold
    expect(getDropdownBoxPosition({ ...head, anchorRect, viewport }).openAbove).toBe(false)

    const held = getDropdownBoxPosition({
      ...head,
      anchorRect,
      held: { openAbove: true, openLeftward: true },
      viewport,
    })

    // A box already open keeps its side and takes only the room from the new measurement, or an
    // ordinary scroll past the point where the sides trade places would throw the panel across the
    // field being read
    expect(held.openAbove).toBe(true)
    expect(held.openLeftward).toBe(true)
    expect(held.boxMaxHeight).toBe(128)
  })

  it('never gives the box more height than the room it actually has', () => {
    // A field low on a short screen, with too little room below to open into and not much above
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 190, left: 20, top: 150, width: 200 },
      viewport: { height: 200, layoutHeight: 200, layoutWidth: 390, offsetLeft: 0, offsetTop: 0, width: 390 },
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
      viewport: { height: 400, layoutHeight: 800, layoutWidth: 390, offsetLeft: 0, offsetTop: 100, width: 390 },
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

    // and less another 42 once a search row and its clearance sit above the list
    expect(withSearch.listMaxHeight).toBe(304)
  })

  it('leaves a searchable box with almost no room showing its head and search and no list', () => {
    const position = getDropdownBoxPosition({
      ...head,
      searchable: true,
      anchorRect: { bottom: 100, left: 20, top: 60, width: 200 },
      viewport: { height: 120, layoutHeight: 120, layoutWidth: 390, offsetLeft: 0, offsetTop: 0, width: 390 },
    })

    // 88 of room above the head, which the head, the box's own edges and the search row take between
    // them. The list is given nothing rather than a negative height the box would then draw around
    expect(position.openAbove).toBe(true)
    expect(position.boxMaxHeight).toBe(88)
    expect(position.listMaxHeight).toBe(0)
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
      viewport: { ...viewport, layoutWidth: 300, width: 300 },
    })

    expect(position.left).toBe(12)
    expect(position.openWidth).toBe(276)
  })

  it('opens leftward when the room on the right cannot hold the box', () => {
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: 150, top: 100, width: 100 },
      viewport: { ...viewport, layoutWidth: 300, width: 300 },
    })

    // 138 to the right of the slot against 238 to the left of it, so the box takes the left and is
    // pinned by the slot's right edge, which is 50 off the right of the page and stays there
    expect(position.openLeftward).toBe(true)
    expect(position.openWidth).toBe(238)
    expect(position.right).toBe(50)

    // Which puts its left edge exactly on the padding
    expect(300 - position.right - position.openWidth).toBe(12)
  })

  it('pulls a slot hanging off the right edge back on screen before opening away from it', () => {
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: 250, top: 100, width: 100 },
      viewport: { ...viewport, layoutWidth: 300, width: 300 },
    })

    // The slot ends 50px past the right of a 300px page, so the box's own right edge comes back to
    // the padding first, and the width it opens to is measured from there
    expect(position.right).toBe(12)
    expect(position.openLeftward).toBe(true)
    expect(position.openWidth).toBe(276)
  })

  it('opens leftward to the full width near the right edge of a roomy page', () => {
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: 600, top: 100, width: 150 },
      viewport,
    })

    // 188 to the right is less than the box wants and there is far more to the left, so it opens
    // that way at its full width, from a right edge that has not moved
    expect(position.openLeftward).toBe(true)
    expect(position.right).toBe(50)
    expect(position.openWidth).toBe(320)

    // 430 to 750 on an 800 page, so both edges are clear of the padding
    expect(800 - position.right - position.openWidth).toBe(430)
  })

  it('opens rightward wherever that side can hold the whole box', () => {
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: 200, top: 100, width: 100 },
      viewport,
    })

    // 588 of room on the right, which is more than the box asks for, so it opens the way it always
    // does rather than picking the side that happens to have a few pixels more
    expect(position.openLeftward).toBe(false)
    expect(position.left).toBe(200)
    expect(position.openWidth).toBe(320)
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
      viewport: { height: 600, layoutHeight: 600, layoutWidth: 400, offsetLeft: 100, offsetTop: 0, width: 300 },
    })

    // A phone pinched and panned sideways, where the visible part starts 100px in. Taken from the
    // width alone the box would be held to 138 and lose 100px of room it actually has
    expect(position.openWidth).toBe(238)
  })

  it('keeps the closed width when the screen is narrower than the slot itself', () => {
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: 0, top: 100, width: 200 },
      viewport: { ...viewport, layoutWidth: 150, width: 150 },
    })

    // 138 of room for a 200 slot, so there is nothing to grow into and nothing to gain by taking
    // the box in narrower than the head inside it
    expect(position.left).toBe(0)
    expect(position.openWidth).toBe(200)
  })

  it('grows a narrow control on a phone and leaves a full-width field alone', () => {
    const phone = { height: 800, layoutHeight: 800, layoutWidth: 390, offsetLeft: 0, offsetTop: 0, width: 390 }

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
