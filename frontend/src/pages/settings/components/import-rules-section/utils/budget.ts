import { countImportRuleConditions, type ImportRule, type ImportRuleBudget } from '@/api/import-rules'

/**
 * Why "Create rule" is unavailable: the rules already hold every condition they may, so a new rule
 * could not hold even one. The limit is the server's, so raising it there changes the words here
 *
 * @param budget - What the server sent, or undefined while it has not
 */
export function getCreateRuleReason(budget: ImportRuleBudget | undefined): string | null {
  if (!budget || budget.used < budget.limit) return null
  return `Your import rules already hold ${budget.limit} conditions, the most allowed`
}

/**
 * Why the editor can not add a condition: the conditions of the other rules and those in the editor
 * have reached the limit. A saved rule's own conditions are left out of the other rules' share, since
 * the editor holds them
 *
 * @param budget - What the server sent, or undefined while it has not, when the server decides
 * @param rule - The saved rule being edited, or null for a new one
 * @param draftCount - The conditions in the editor now, those inside groups included
 */
export function getAddConditionReason(
  budget: ImportRuleBudget | undefined,
  rule: ImportRule | null,
  draftCount: number,
): string | null {
  if (!budget) return null
  const heldByOthers = budget.used - (rule ? countImportRuleConditions(rule.conditions) : 0)
  if (heldByOthers + draftCount < budget.limit) return null
  return `Your import rules can hold ${budget.limit} conditions in all`
}
