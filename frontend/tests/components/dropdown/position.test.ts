/**
 * Tests where the open dropdown sits, how much of it the option list gets and how wide it opens,
 * so a change catches a box growing off the screen, out of its modal over the backdrop or over a
 * dialogue's title or buttons, a list kept inside a short modal too short to read, a head that shifts
 * as the box opens, or a list clipped by its own box
 */
import { describe, expect, it } from 'vitest'
import {
  clampDropdownViewportToPanel,
  findDropdownPanel,
  getDropdownBoxPosition,
  isSameDropdownBoxPosition,
} from '@/components/dropdown/position'

const viewport = {
  height: 600,
  layoutHeight: 600,
  layoutWidth: 800,
  offsetLeft: 0,
  offsetTop: 0,
  width: 800,
}

const head = { bounds: null, headHeight: 40, held: null, searchable: false }

describe('dropdown box placement', () => {
  it('pins the box by the head’s upper edge when the list grows downward', () => {
    expect(
      getDropdownBoxPosition({
        ...head,
        anchorRect: { bottom: 140, left: 20, top: 100, width: 200 },
        viewport,
      }),
    ).toEqual({
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

  it('keeps the box inside a dialog’s body, clear of its title and buttons', () => {
    // Category in Add transaction on a 1280x800 window, where the body runs from under the title at
    // 172 to the top of the buttons at 643
    const bounds = { bottom: 643, top: 172 }
    const position = getDropdownBoxPosition({
      ...head,
      bounds,
      searchable: true,
      anchorRect: { bottom: 423, left: 20, top: 385, width: 200 },
      viewport: { ...viewport, height: 800, layoutHeight: 800 },
    })

    // The screen has 411 above and 403 below, so on its own the box would open upward over the
    // title. Inside the body it has 246 below and 239 above, so it opens down and ends above the
    // buttons, with 150px of list
    expect(position.openAbove).toBe(false)
    expect(position.top + position.boxMaxHeight).toBeLessThanOrEqual(bounds.bottom)
    expect(position.listMaxHeight).toBe(150)
  })

  it('keeps the box inside a dialogue’s body when the panel around it leaves fewer than five rows', () => {
    // The same Category field, with the dialogue's panel around the body as every bounded field has
    const bounds = { bottom: 643, top: 172 }
    const position = getDropdownBoxPosition({
      ...head,
      bounds,
      searchable: true,
      anchorRect: { bottom: 423, left: 20, top: 385, width: 200 },
      panel: { bottom: 744, left: 0, right: 800, top: 56 },
      viewport: { ...viewport, height: 800, layoutHeight: 800 },
    })

    // The 150px list is under five rows, so the box is placed again against the whole screen, and
    // the body still holds it: it opens down and ends above the buttons rather than upward over the
    // title
    expect(position.openAbove).toBe(false)
    expect(position.top + position.boxMaxHeight).toBeLessThanOrEqual(bounds.bottom)
    expect(position.listMaxHeight).toBe(150)
  })

  it('opens upward inside a dialog’s body without reaching over its title', () => {
    const bounds = { bottom: 862, top: 233 }
    const position = getDropdownBoxPosition({
      ...head,
      bounds,
      searchable: true,
      anchorRect: { bottom: 579, left: 20, top: 541, width: 200 },
      viewport: { ...viewport, height: 1080, layoutHeight: 1080 },
    })

    // 309 below the head inside the body against 334 above it
    expect(position.openAbove).toBe(true)
    expect(579 - position.boxMaxHeight).toBeGreaterThanOrEqual(bounds.top)
  })

  it('stays inside a dialog’s body for a field just under its title, where only the room below is enough', () => {
    const bounds = { bottom: 450, top: 172 }
    const position = getDropdownBoxPosition({
      ...head,
      bounds,
      searchable: true,
      anchorRect: { bottom: 230, left: 20, top: 190, width: 200 },
      viewport: { ...viewport, height: 800, layoutHeight: 800 },
    })

    // 46 above the head inside the body holds no list, but the 248 below does, so the box stays in
    // the body and ends above the buttons rather than taking the screen's 400
    expect(position.openAbove).toBe(false)
    expect(position.top + position.boxMaxHeight).toBeLessThanOrEqual(bounds.bottom)
  })

  it('takes the room the screen has when a dialog’s body would leave fewer than three options', () => {
    const position = getDropdownBoxPosition({
      ...head,
      bounds: { bottom: 420, top: 300 },
      anchorRect: { bottom: 370, left: 20, top: 330, width: 200 },
      viewport,
    })

    // The body leaves 78 below and 58 above, too little for any list, so the box opens over the
    // dialog's edges into the 358 the screen has above
    expect(position.openAbove).toBe(true)
    expect(position.boxMaxHeight).toBe(358)
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

  it('opens exactly as wide as its slot when asked to match the field', () => {
    const anchorRect = { bottom: 140, left: 20, top: 100, width: 200 }

    // A narrow slot with room beside it grows to the maximum. A dropdown inside a panel must not
    // do that, since the list would pass the panel's edge
    expect(getDropdownBoxPosition({ ...head, anchorRect, viewport }).openWidth).toBe(320)
    expect(getDropdownBoxPosition({ ...head, anchorRect, viewport, matchFieldWidth: true }).openWidth).toBe(200)
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

  describe('a box opened from a field inside a modal', () => {
    const wide = { height: 800, layoutHeight: 800, layoutWidth: 1200, offsetLeft: 0, offsetTop: 0, width: 1200 }
    const panel = { bottom: 700, left: 300, right: 900, top: 50 }

    it('opens leftward from a field near the panel’s right edge rather than out over the backdrop', () => {
      const anchorRect = { bottom: 140, left: 700, top: 100, width: 150 }
      const unclamped = getDropdownBoxPosition({ ...head, anchorRect, viewport: wide })
      const clamped = getDropdownBoxPosition({ ...head, anchorRect, panel, viewport: wide })

      // Measured against the screen there are 488px to the right, so the box would open to 1020 and
      // hang 120px past the panel. Against the panel there are 188, so it opens the other way
      expect(unclamped.openLeftward).toBe(false)
      expect(clamped.openLeftward).toBe(true)
      expect(clamped.openWidth).toBe(320)

      // From 530 to 850, inside the panel's 300 to 900
      expect(1200 - clamped.right - clamped.openWidth).toBe(530)
    })

    it('opens narrower when neither side of the panel can hold the full width', () => {
      const position = getDropdownBoxPosition({
        ...head,
        anchorRect: { bottom: 140, left: 320, top: 100, width: 100 },
        panel: { ...panel, right: 600 },
        viewport: wide,
      })

      // 268 to the right against 108 to the left, so it keeps opening rightward and stops at the
      // panel's padding instead of growing to 320 over the backdrop
      expect(position.openLeftward).toBe(false)
      expect(position.openWidth).toBe(268)
      expect(position.left + position.openWidth).toBe(588)
    })

    it('opens upward from a field near the foot of the panel rather than past it over the backdrop', () => {
      const anchorRect = { bottom: 340, left: 320, top: 300, width: 200 }
      const unclamped = getDropdownBoxPosition({ ...head, anchorRect, viewport: wide })
      const clamped = getDropdownBoxPosition({ ...head, anchorRect, panel: { ...panel, bottom: 420 }, viewport: wide })

      // Against the screen there are 488px below, so the box would open down to 700, 280px past the
      // panel's foot. Inside the panel there are 108 below and 278 above, so it opens up instead
      expect(unclamped.openAbove).toBe(false)
      expect(unclamped.top + unclamped.boxMaxHeight).toBe(700)
      expect(clamped.openAbove).toBe(true)
      expect(clamped.boxMaxHeight).toBe(278)
      expect(clamped.bottom).toBe(460)
    })

    it('stops a box opening upward at the panel’s top padding rather than over the backdrop above it', () => {
      const position = getDropdownBoxPosition({
        ...head,
        anchorRect: { bottom: 400, left: 320, top: 360, width: 200 },
        panel: { ...panel, top: 120, bottom: 420 },
        viewport: wide,
      })

      // 48px below inside the panel against 268 above, so it opens up to 132, the panel's top plus
      // its padding, and the list takes the 214 the head and box edges leave, room for five rows
      expect(position.openAbove).toBe(true)
      expect(400 - position.boxMaxHeight).toBe(132)
      expect(position.listMaxHeight).toBe(214)
    })

    it('grows past the panel toward the roomier side of the screen when neither side of the panel holds five rows', () => {
      const shortPanel = { ...panel, top: 200, bottom: 420 }
      const anchorRect = { bottom: 400, left: 700, top: 360, width: 150 }
      const inPanel = getDropdownBoxPosition({
        ...head,
        searchable: true,
        anchorRect,
        viewport: clampDropdownViewportToPanel(wide, shortPanel),
      })
      const position = getDropdownBoxPosition({
        ...head,
        searchable: true,
        anchorRect,
        panel: shortPanel,
        viewport: wide,
      })

      // Kept to the panel, 188 above leaves the list 92 after the head, search and box edges, under
      // three rows of 36, and 48 below leaves none
      expect(inPanel.listMaxHeight).toBe(92)

      // The screen has 428 below against 388 above, so the box opens down to its full 400, ending at
      // 760 where the panel ends at 420
      expect(position.openAbove).toBe(false)
      expect(position.top + position.boxMaxHeight).toBe(760)
      expect(position.listMaxHeight).toBe(304)

      // Its sides still keep to the panel, so it opens leftward rather than 120px past the panel's right
      expect(position.openLeftward).toBe(true)
      expect(1200 - position.right).toBe(850)
    })

    it('keeps to the panel’s sides measured as the screen measures them, whose edges are read rather than copied', () => {
      // A measured box, such as getBoundingClientRect returns, keeps its edges on its prototype, so
      // copying its own fields gives none of them
      class MeasuredBox {
        get bottom() {
          return 420
        }
        get left() {
          return 300
        }
        get right() {
          return 900
        }
        get top() {
          return 200
        }
      }
      const anchorRect = { bottom: 400, left: 700, top: 360, width: 150 }
      const measured = getDropdownBoxPosition({
        ...head,
        searchable: true,
        anchorRect,
        panel: new MeasuredBox(),
        viewport: wide,
      })
      const plain = getDropdownBoxPosition({
        ...head,
        searchable: true,
        anchorRect,
        panel: { ...panel, top: 200, bottom: 420 },
        viewport: wide,
      })

      expect(measured).toEqual(plain)
    })

    // The panel's top sets the room above a field near its foot, and with it the list kept inside: the
    // head and box edges take 54 of the room, and five rows take 180
    it.each([
      { list: 179, panelTop: 155, openAbove: false, listMaxHeight: 346 },
      { list: 180, panelTop: 154, openAbove: true, listMaxHeight: 180 },
      { list: 181, panelTop: 153, openAbove: true, listMaxHeight: 181 },
    ])(
      'keeps a box whose list would be $list inside the panel only from five rows up',
      ({ panelTop, openAbove, listMaxHeight }) => {
        const position = getDropdownBoxPosition({
          ...head,
          anchorRect: { bottom: 400, left: 320, top: 360, width: 200 },
          panel: { ...panel, top: panelTop, bottom: 420 },
          viewport: wide,
        })

        // Below five rows it leaves the panel for the screen's 428 below, against 388 above
        expect(position.openAbove).toBe(openAbove)
        expect(position.listMaxHeight).toBe(listMaxHeight)
      },
    )

    it('grows past the panel’s top over the modal’s title when the screen has more room above', () => {
      const position = getDropdownBoxPosition({
        ...head,
        anchorRect: { bottom: 740, left: 320, top: 700, width: 200 },
        panel: { ...panel, top: 600, bottom: 780 },
        viewport: wide,
      })

      // 128 above and 68 below inside the panel leave the list 74 at most, so it takes the 728 the
      // screen has above and opens up to its full 400, from 340, 260px above the panel's top
      expect(position.openAbove).toBe(true)
      expect(740 - position.boxMaxHeight).toBe(340)
      expect(position.listMaxHeight).toBe(346)
    })

    it('keeps the screen’s own edges where the panel reaches past them, and the screen’s outside a modal', () => {
      const panned = { ...wide, offsetLeft: 100, offsetTop: 40, height: 500, width: 300 }

      expect(clampDropdownViewportToPanel(panned, { bottom: 900, left: -50, right: 900, top: -20 })).toEqual(panned)
      expect(clampDropdownViewportToPanel(wide, null)).toBe(wide)
    })
  })

  describe('a box following its head while the page moves under it', () => {
    // A modal that grows re-centres itself, which slides every field in it without the page
    // scrolling. These pin that the placement actually changes when that happens, since the box is
    // re-measured every frame precisely to catch it
    const downward = { openAbove: false, openLeftward: false }
    const upward = { openAbove: true, openLeftward: false }

    it('moves the upper edge of a box that opened downward when its head rises', () => {
      const before = getDropdownBoxPosition({
        ...head,
        held: downward,
        anchorRect: { bottom: 140, left: 20, top: 100, width: 200 },
        viewport,
      })
      const after = getDropdownBoxPosition({
        ...head,
        held: downward,
        anchorRect: { bottom: 130, left: 20, top: 90, width: 200 },
        viewport,
      })

      expect(before.top).toBe(100)
      expect(after.top).toBe(90)
      expect(isSameDropdownBoxPosition(before, after)).toBe(false)
    })

    it('moves the lower edge of a box that opened upward when its head rises', () => {
      const before = getDropdownBoxPosition({
        ...head,
        held: upward,
        anchorRect: { bottom: 140, left: 20, top: 100, width: 200 },
        viewport,
      })
      const after = getDropdownBoxPosition({
        ...head,
        held: upward,
        anchorRect: { bottom: 130, left: 20, top: 90, width: 200 },
        viewport,
      })

      // Measured from the bottom of the page, so a head that rises by 10 puts this edge 10 further up
      expect(before.bottom).toBe(460)
      expect(after.bottom).toBe(470)
      expect(isSameDropdownBoxPosition(before, after)).toBe(false)
    })

    it('reports a head that has not moved as the same placement', () => {
      const anchorRect = { bottom: 140, left: 20, top: 100, width: 200 }
      const first = getDropdownBoxPosition({ ...head, held: downward, anchorRect, viewport })
      const second = getDropdownBoxPosition({ ...head, held: downward, anchorRect, viewport })

      expect(first).not.toBe(second)
      expect(isSameDropdownBoxPosition(first, second)).toBe(true)
    })

    // Every field, one at a time. A comparison left out of isSameDropdownBoxPosition would let the
    // box keep a placement that has actually moved, and nothing else in the suite would notice
    it('reports a difference in any single field', () => {
      const base = getDropdownBoxPosition({
        ...head,
        held: downward,
        anchorRect: { bottom: 140, left: 20, top: 100, width: 200 },
        viewport,
      })

      const changes: Array<Partial<typeof base>> = [
        { bottom: base.bottom + 1 },
        { boxMaxHeight: base.boxMaxHeight + 1 },
        { left: base.left + 1 },
        { listMaxHeight: base.listMaxHeight + 1 },
        { openAbove: !base.openAbove },
        { openLeftward: !base.openLeftward },
        { openWidth: base.openWidth + 1 },
        { right: base.right + 1 },
        { top: base.top + 1 },
        { width: base.width + 1 },
      ]

      // One entry per field, so a field added to the placement without being compared shows up here
      expect(changes).toHaveLength(Object.keys(base).length)

      for (const change of changes) {
        expect(isSameDropdownBoxPosition(base, { ...base, ...change })).toBe(false)
      }
    })
  })
})

describe('a dropdown that did not ask to keep to its modal', () => {
  const wide = { height: 800, layoutHeight: 800, layoutWidth: 1200, offsetLeft: 0, offsetTop: 0, width: 1200 }
  const panelEdges = { bottom: 500, left: 300, right: 900, top: 100 }
  const slot = { closest: () => ({ getBoundingClientRect: () => panelEdges }) }
  const anchorRect = { bottom: 440, left: 700, top: 400, width: 150 }

  const place = (clampToPanel: boolean) =>
    getDropdownBoxPosition({ ...head, anchorRect, panel: findDropdownPanel(slot, clampToPanel), viewport: wide })

  it("finds no panel unless asked, so the screen's room is used as outside a modal", () => {
    expect(findDropdownPanel(slot, false)).toBeNull()
    expect(findDropdownPanel(slot, true)).toEqual(panelEdges)
  })

  it("opens rightward over the backdrop from a field near the panel's right edge", () => {
    expect(place(false).openLeftward).toBe(false)
    expect(place(true).openLeftward).toBe(true)
  })

  it("lists its rows over the backdrop from a field near the panel's foot", () => {
    expect(place(false).listMaxHeight).toBeGreaterThan(place(true).listMaxHeight)
  })
})
