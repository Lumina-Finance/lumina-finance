/**
 * Tests the wrapping the modal shell relies on to hold keyboard focus inside an open dialog
 */
import { describe, expect, it } from 'vitest'
import { getNextTabStop } from '@/components/modal/focus'

describe('modal focus wrapping', () => {
  const tabStops = ['name', 'currency', 'cancel', 'submit']

  it('wraps forward from the last control to the first', () => {
    expect(getNextTabStop(tabStops, 'submit', false)).toBe('name')
    expect(getNextTabStop(tabStops, 'name', false)).toBe('currency')
  })

  it('wraps backward from the first control to the last', () => {
    expect(getNextTabStop(tabStops, 'name', true)).toBe('submit')
    expect(getNextTabStop(tabStops, 'currency', true)).toBe('name')
  })

  it('starts from either end when focus is not on a control inside the panel', () => {
    expect(getNextTabStop(tabStops, null, false)).toBe('name')
    expect(getNextTabStop(tabStops, null, true)).toBe('submit')
  })

  it('reports no destination for a panel with nothing focusable in it', () => {
    expect(getNextTabStop([], null, false)).toBeNull()
  })
})
