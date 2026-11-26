/**
 * Covers which rule's Actions button takes focus once the rule that held it has moved or been deleted
 *
 * These tests catch focus sent to the wrong neighbour, an index past the end, and a rule that stays
 * shown losing focus to the one beside it
 */
import { describe, expect, it } from 'vitest'
import { pickFocusRuleId } from '@/pages/settings/components/import-rules-section/utils/focus'

const rows = (...ids: string[]) => ids.map((id) => ({ id }))

describe('the rule that takes focus', () => {
  it('is the held rule while it is still shown, wherever it now sits', () => {
    expect(pickFocusRuleId(rows('a', 'c', 'b'), { id: 'b', index: 1 })).toBe('b')
  })

  it('is the rule now in the place of one that left', () => {
    expect(pickFocusRuleId(rows('a', 'c'), { id: 'b', index: 1 })).toBe('c')
    expect(pickFocusRuleId(rows('b', 'c'), { id: 'a', index: 0 })).toBe('b')
  })

  it('is the last rule when the one that left was the last', () => {
    expect(pickFocusRuleId(rows('a', 'b'), { id: 'c', index: 2 })).toBe('b')
  })

  it('is nothing when no rule is left', () => {
    expect(pickFocusRuleId([], { id: 'a', index: 0 })).toBeNull()
  })

  it('is never a deleted rule that is still shown', () => {
    expect(pickFocusRuleId(rows('a', 'b', 'c'), { id: 'b', index: 1, deleted: true })).toBe('c')
    expect(pickFocusRuleId(rows('a', 'b', 'c'), { id: 'c', index: 2, deleted: true })).toBe('b')
    expect(pickFocusRuleId(rows('a'), { id: 'a', index: 0, deleted: true })).toBeNull()
  })
})
