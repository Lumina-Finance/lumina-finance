/**
 * Tests the drop-down's keyboard policy, so a rewrite catches a key that stops opening the menu, a
 * highlight that lands on an option nobody can choose, or Enter committing the wrong row
 */
import { describe, expect, it } from 'vitest'
import { getDropdownKeyAction } from '@/components/dropdown/keyboard'

const threeEnabled = [false, false, false]

const base = {
  fromTrigger: true,
  highlightedIndex: -1,
  open: false,
  optionDisabled: threeEnabled,
  selectedIndex: -1,
}

describe('drop-down keyboard policy', () => {
  it('opens on Space from the pill and not from the search field', () => {
    expect(getDropdownKeyAction({ ...base, key: ' ' })).toEqual({ kind: 'open', highlightedIndex: 0 })
    expect(getDropdownKeyAction({ ...base, key: ' ', fromTrigger: false }))
      .toEqual({ kind: 'none', swallow: false })
  })

  it('holds the keys that would otherwise scroll the page or activate the pill under an open menu', () => {
    // Space from the pill while the menu is open: letting it through activates the button and closes
    // the menu the user just opened
    expect(getDropdownKeyAction({ ...base, key: ' ', open: true }))
      .toEqual({ kind: 'none', swallow: true })

    // Arrow up on a closed pill: letting it through scrolls the page under the field
    expect(getDropdownKeyAction({ ...base, key: 'ArrowUp' }))
      .toEqual({ kind: 'none', swallow: true })

    // Enter on a row that cannot be chosen: letting it through activates the pill and closes the menu
    expect(getDropdownKeyAction({
      ...base,
      key: 'Enter',
      open: true,
      highlightedIndex: 1,
      optionDisabled: [false, true, false],
    })).toEqual({ kind: 'none', swallow: true })
  })

  it('opens on Enter and Arrow Down, seeding the highlight from the current value only where one is set', () => {
    expect(getDropdownKeyAction({ ...base, key: 'Enter', selectedIndex: 2 }))
      .toEqual({ kind: 'open', highlightedIndex: 2 })
    expect(getDropdownKeyAction({ ...base, key: 'ArrowDown', selectedIndex: 2 }))
      .toEqual({ kind: 'open', highlightedIndex: 0 })
  })

  it('stops at the ends of the list rather than wrapping round', () => {
    expect(getDropdownKeyAction({ ...base, key: 'ArrowDown', open: true, highlightedIndex: 2 }))
      .toEqual({ kind: 'move', highlightedIndex: 2 })
    expect(getDropdownKeyAction({ ...base, key: 'ArrowUp', open: true, highlightedIndex: 0 }))
      .toEqual({ kind: 'move', highlightedIndex: 0 })
  })

  it('moves up to the first option when nothing is highlighted yet', () => {
    expect(getDropdownKeyAction({ ...base, key: 'ArrowUp', open: true, highlightedIndex: -1 }))
      .toEqual({ kind: 'move', highlightedIndex: 0 })
  })

  it('steps over an option that cannot be chosen', () => {
    const middleDisabled = [false, true, false]

    expect(getDropdownKeyAction({
      ...base,
      key: 'ArrowDown',
      open: true,
      highlightedIndex: 0,
      optionDisabled: middleDisabled,
    })).toEqual({ kind: 'move', highlightedIndex: 2 })

    expect(getDropdownKeyAction({
      ...base,
      key: 'ArrowUp',
      open: true,
      highlightedIndex: 2,
      optionDisabled: middleDisabled,
    })).toEqual({ kind: 'move', highlightedIndex: 0 })
  })

  it('leaves the highlight on nothing rather than on a row that cannot be chosen', () => {
    // Sitting on the first option, which is disabled, with nothing selectable above it
    expect(getDropdownKeyAction({
      ...base,
      key: 'ArrowUp',
      open: true,
      highlightedIndex: 0,
      optionDisabled: [true, false, false],
    })).toEqual({ kind: 'move', highlightedIndex: -1 })

    expect(getDropdownKeyAction({
      ...base,
      key: 'ArrowDown',
      open: true,
      optionDisabled: [true, true],
    })).toEqual({ kind: 'move', highlightedIndex: -1 })
  })

  it('holds the highlight where it is when nothing selectable lies further on', () => {
    expect(getDropdownKeyAction({
      ...base,
      key: 'ArrowDown',
      open: true,
      highlightedIndex: 0,
      optionDisabled: [false, true],
    })).toEqual({ kind: 'move', highlightedIndex: 0 })
  })

  it('opens onto the first option that can be chosen when the current value cannot', () => {
    expect(getDropdownKeyAction({
      ...base,
      key: 'Enter',
      selectedIndex: 0,
      optionDisabled: [true, false, false],
    })).toEqual({ kind: 'open', highlightedIndex: 1 })
  })

  it('commits the highlighted option on Enter while the list is open', () => {
    expect(getDropdownKeyAction({ ...base, key: 'Enter', open: true, highlightedIndex: 1 }))
      .toEqual({ kind: 'select', index: 1 })
  })

  it('answers Escape only while the list is open, so a closed field leaves the key to the modal behind it', () => {
    expect(getDropdownKeyAction({ ...base, key: 'Escape', open: true })).toEqual({ kind: 'close' })
    expect(getDropdownKeyAction({ ...base, key: 'Escape' })).toEqual({ kind: 'none', swallow: false })
  })

  it('leaves every other key alone', () => {
    expect(getDropdownKeyAction({ ...base, key: 'a', open: true })).toEqual({ kind: 'none', swallow: false })
    expect(getDropdownKeyAction({ ...base, key: 'Tab', open: true })).toEqual({ kind: 'none', swallow: false })
  })
})
