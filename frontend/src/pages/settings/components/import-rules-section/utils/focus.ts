/**
 * A rule keyboard focus is held on, with the place it had among the shown rules, counted from zero. A rule
 * that is `deleted` may still be shown for a moment, and never takes focus
 */
export type HeldRule = { id: string; index: number; deleted?: boolean }

/**
 * The rule whose Actions button takes focus: the held rule while it is shown and not deleted, otherwise the rule
 * now in the place it left, or the last rule when it was the last, or null when no rule is left to take it
 *
 * @param rules - The rows as shown, in order
 */
export function pickFocusRuleId(rules: readonly { id: string }[], held: HeldRule): string | null {
  if (!held.deleted && rules.some((rule) => rule.id === held.id)) return held.id
  const others = rules.filter((rule) => rule.id !== held.id)
  if (others.length === 0) return null
  return others[Math.min(held.index, others.length - 1)].id
}
