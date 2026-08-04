/**
 * Tests where the open drop-down sits and how much of it the option list gets, so a change catches a
 * box growing off the screen, a head that shifts as the box opens, or a list clipped by its own box
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
      top: 100,
      width: 208,
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

  it('gives a taller head less list, since they share one box', () => {
    const toolbar = getDropdownBoxPosition({
      ...head,
      headHeight: 44,
      anchorRect: { bottom: 144, left: 20, top: 100, width: 200 },
      viewport,
    })

    expect(toolbar.listMaxHeight).toBe(342)
  })

  it('keeps the box inside horizontal viewport padding', () => {
    expect(getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: -20, top: 100, width: 200 },
      viewport: { ...viewport, width: 300 },
    }).left).toBe(12)
  })

  it('widens a box over a narrow head and clamps on the widened box', () => {
    const position = getDropdownBoxPosition({
      ...head,
      anchorRect: { bottom: 140, left: 250, top: 100, width: 100 },
      viewport: { ...viewport, width: 300 },
    })

    // A 100px head in a table cell would open a list too narrow to read, so it widens to the
    // minimum and is pushed back inside the viewport instead of hanging off the right edge
    expect(position.width).toBe(208)
    expect(position.left).toBe(80)
  })
})
