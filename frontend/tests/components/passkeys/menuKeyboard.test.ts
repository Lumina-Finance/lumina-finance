/**
 * Tests which item the overflow menu's arrow, Home and End keys move focus to, so a rewrite catches a key
 * that stops moving focus or one that walks off the end of the list
 */
import { describe, expect, it } from 'vitest'
import { getMenuItemTarget } from '@/components/passkeys/menuKeyboard'

describe('overflow menu keyboard policy', () => {
  it('moves between the items with Up and Down, wrapping round the ends', () => {
    expect(getMenuItemTarget('ArrowDown', 0, 2)).toBe(1)
    expect(getMenuItemTarget('ArrowDown', 1, 2)).toBe(0)
    expect(getMenuItemTarget('ArrowUp', 1, 2)).toBe(0)
    expect(getMenuItemTarget('ArrowUp', 0, 2)).toBe(1)
  })

  it('enters from the trigger at the first item with Down and at the last with Up', () => {
    expect(getMenuItemTarget('ArrowDown', -1, 3)).toBe(0)
    expect(getMenuItemTarget('ArrowUp', -1, 3)).toBe(2)
  })

  it('goes to the first and last items with Home and End', () => {
    expect(getMenuItemTarget('Home', 2, 3)).toBe(0)
    expect(getMenuItemTarget('End', 0, 3)).toBe(2)
  })

  it('leaves other keys, and a menu with no items, alone', () => {
    expect(getMenuItemTarget('a', 0, 3)).toBeNull()
    expect(getMenuItemTarget('Enter', 0, 3)).toBeNull()
    expect(getMenuItemTarget('ArrowDown', -1, 0)).toBeNull()
  })
})
