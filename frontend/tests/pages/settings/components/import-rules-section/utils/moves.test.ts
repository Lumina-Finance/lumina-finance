/**
 * Covers the position a drop or a menu move sends to the server
 *
 * These tests catch positions counted from one, a move sent when nothing moved, and Move down offered on
 * the last rule loaded when more wait on the server, or withheld on the last rule of all
 */
import { describe, expect, it } from 'vitest'
import type { ImportRule } from '@/api/import-rules'
import {
  FIRST_RULE_REASON,
  LAST_RULE_REASON,
  getDropPosition,
  getMenuMoves,
} from '@/pages/settings/components/import-rules-section/utils/moves'

function rules(count: number): ImportRule[] {
  return Array.from({ length: count }, (_, position) => ({
    id: `rule-${position}`,
    name: `Rule ${position}`,
    position,
    match: 'all',
    conditions: [],
    merchant: null,
    category: null,
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }))
}

describe('the position a drop sends', () => {
  it('is the position of the row dropped on, counted from zero, in either direction', () => {
    const rows = rules(4)

    expect(getDropPosition(rows, 'rule-0', 'rule-2')).toBe(2)
    expect(getDropPosition(rows, 'rule-3', 'rule-0')).toBe(0)
  })

  it('is nothing when the rule is dropped where it was or on a row that is not loaded', () => {
    const rows = rules(3)

    expect(getDropPosition(rows, 'rule-1', 'rule-1')).toBeNull()
    expect(getDropPosition(rows, 'rule-1', 'missing')).toBeNull()
    expect(getDropPosition(rows, 'missing', 'rule-1')).toBeNull()
  })
})

describe('the menu moves', () => {
  it('send a middle rule one place either way', () => {
    expect(getMenuMoves(rules(3), 'rule-1', false)).toEqual({
      up: { position: 0, reason: null },
      down: { position: 2, reason: null },
    })
  })

  it('refuse Move up on the first rule with its reason', () => {
    const { up, down } = getMenuMoves(rules(3), 'rule-0', false)

    expect(up).toEqual({ position: null, reason: FIRST_RULE_REASON })
    expect(down.position).toBe(1)
  })

  it('refuse Move down on the last rule only when nothing more waits on the server', () => {
    expect(getMenuMoves(rules(3), 'rule-2', false).down).toEqual({ position: null, reason: LAST_RULE_REASON })
    expect(getMenuMoves(rules(3), 'rule-2', true).down).toEqual({ position: 3, reason: null })
  })

  it('refuse both on a lone rule', () => {
    const { up, down } = getMenuMoves(rules(1), 'rule-0', false)

    expect(up.position).toBeNull()
    expect(down.position).toBeNull()
  })
})
