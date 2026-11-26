import type { ImportRule } from '@/api/import-rules'

export const FIRST_RULE_REASON = 'This rule is already first'
export const LAST_RULE_REASON = 'This rule is already last'

/** Where a menu move would send a rule, or why it can't go that way */
export type MenuMove = { position: number; reason: null } | { position: null; reason: string }

/**
 * The position a rule dropped on another takes, counted from zero
 *
 * Loaded rows are the first ones in order, so a row's position is its place in the list. A rule dropped
 * where it already was, or on a row that is no longer loaded, moves nowhere
 *
 * @param rules - The rows as shown, in order
 */
export function getDropPosition(rules: ImportRule[], activeId: string, overId: string): number | null {
  if (activeId === overId) return null
  const active = rules.find((rule) => rule.id === activeId)
  const over = rules.find((rule) => rule.id === overId)
  if (!active || !over || active.position === over.position) return null
  return over.position
}

/**
 * Where Move up and Move down send a rule, with the reason for one that can't
 *
 * @param rules - The rows as shown, in order
 * @param hasMore - Whether more rules wait on the server, so the last one shown may not be the last
 */
export function getMenuMoves(rules: ImportRule[], ruleId: string, hasMore: boolean): { up: MenuMove; down: MenuMove } {
  const index = rules.findIndex((rule) => rule.id === ruleId)
  if (index === -1)
    return { up: { position: null, reason: FIRST_RULE_REASON }, down: { position: null, reason: LAST_RULE_REASON } }
  const rule = rules[index]
  return {
    up: index === 0 ? { position: null, reason: FIRST_RULE_REASON } : { position: rule.position - 1, reason: null },
    down:
      index === rules.length - 1 && !hasMore
        ? { position: null, reason: LAST_RULE_REASON }
        : { position: rule.position + 1, reason: null },
  }
}
