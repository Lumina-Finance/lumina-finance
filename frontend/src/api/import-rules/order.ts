import type { ImportRuleItem } from '@/api/import-rules/types'

/**
 * How many conditions a rule holds in all, as the server counts them against the budget: each one
 * once, those inside groups included, and a group for nothing
 */
export function countImportRuleConditions(items: ImportRuleItem[]): number {
  return items.reduce((total, item) => total + (item.kind === 'group' ? item.conditions.length : 1), 0)
}
