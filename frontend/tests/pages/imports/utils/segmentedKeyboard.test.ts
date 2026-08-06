/**
 * Tests the keyboard policy behind the category type control, since announcing itself as a set of
 * radio buttons promises the arrow keys work and the promise is not the browser's to keep here
 */
import { describe, expect, it } from 'vitest'
import { getSegmentedControlKeyAction } from '@/pages/imports/utils'

const COUNT = 3

describe('moving through a segmented control by keyboard', () => {
  it('moves forward on the right and down arrows, wrapping at the end', () => {
    expect(getSegmentedControlKeyAction('ArrowRight', 0, COUNT)).toEqual({ kind: 'move', index: 1 })
    expect(getSegmentedControlKeyAction('ArrowDown', 1, COUNT)).toEqual({ kind: 'move', index: 2 })
    expect(getSegmentedControlKeyAction('ArrowRight', 2, COUNT)).toEqual({ kind: 'move', index: 0 })
  })

  it('moves back on the left and up arrows, wrapping at the start', () => {
    expect(getSegmentedControlKeyAction('ArrowLeft', 2, COUNT)).toEqual({ kind: 'move', index: 1 })
    expect(getSegmentedControlKeyAction('ArrowUp', 1, COUNT)).toEqual({ kind: 'move', index: 0 })
    expect(getSegmentedControlKeyAction('ArrowLeft', 0, COUNT)).toEqual({ kind: 'move', index: 2 })
  })

  it('jumps to either end on Home and End', () => {
    expect(getSegmentedControlKeyAction('Home', 2, COUNT)).toEqual({ kind: 'move', index: 0 })
    expect(getSegmentedControlKeyAction('End', 0, COUNT)).toEqual({ kind: 'move', index: COUNT - 1 })
  })

  // The control starts with nothing chosen, so the first arrow press has no option to move from
  it('enters an unanswered control from whichever end the arrow came from', () => {
    expect(getSegmentedControlKeyAction('ArrowRight', -1, COUNT)).toEqual({ kind: 'move', index: 0 })
    expect(getSegmentedControlKeyAction('ArrowLeft', -1, COUNT)).toEqual({ kind: 'move', index: COUNT - 1 })
  })

  it('leaves every other key to whatever else would handle it', () => {
    expect(getSegmentedControlKeyAction('Enter', 0, COUNT)).toEqual({ kind: 'none' })
    expect(getSegmentedControlKeyAction('Tab', 0, COUNT)).toEqual({ kind: 'none' })
    expect(getSegmentedControlKeyAction(' ', 0, COUNT)).toEqual({ kind: 'none' })
  })

  it('does nothing in a control with no options', () => {
    expect(getSegmentedControlKeyAction('ArrowRight', -1, 0)).toEqual({ kind: 'none' })
    expect(getSegmentedControlKeyAction('Home', -1, 0)).toEqual({ kind: 'none' })
  })
})
