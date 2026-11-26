import type { ImportRule, ImportRuleItem } from '@/api/import-rules/types'

/**
 * How many conditions a rule holds in all, as the server counts them against the budget: each one
 * once, those inside groups included, and a group for nothing
 */
export function countImportRuleConditions(items: ImportRuleItem[]): number {
  return items.reduce((total, item) => total + (item.kind === 'group' ? item.conditions.length : 1), 0)
}

/**
 * Numbers rules from zero in the order given, leaving a rule alone that already holds its number
 *
 * A list of loaded rules always starts at the first page, so a rule's place among them is its place in
 * the order the rules are checked
 */
export function numberImportRules(rules: ImportRule[]): ImportRule[] {
  return rules.map((rule, index) => (rule.position === index ? rule : { ...rule, position: index }))
}

/**
 * Moves a rule to a place among the rules given and numbers them again, or returns the same list when
 * there is nothing to show: the rule isn't among them, the place is past them, or the rule is there already
 *
 * A place beyond the loaded rules can't be shown yet, and putting the rule at their end would show it
 * somewhere it isn't, so the caller leaves that to the read that follows a move
 *
 * @param position - Where the rule should end up, counted from zero
 */
export function moveImportRuleInList(rules: ImportRule[], ruleId: string, position: number): ImportRule[] {
  const from = rules.findIndex((rule) => rule.id === ruleId)
  if (from === -1 || position < 0 || position >= rules.length || position === from) return rules

  const moved = [...rules]
  const [rule] = moved.splice(from, 1)
  moved.splice(position, 0, rule)
  return numberImportRules(moved)
}
