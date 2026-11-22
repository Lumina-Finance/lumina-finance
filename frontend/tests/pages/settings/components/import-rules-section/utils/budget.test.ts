/**
 * Covers when the editor and the Create rule button say the budget of conditions is spent, and the
 * words they say it in
 *
 * These tests catch a figure typed into a text instead of read from the server, a saved rule's own
 * conditions counted twice while it is edited, a group's conditions left out of the count, and an
 * add button held off one condition too early or too late
 */
import { describe, expect, it } from 'vitest'
import type { ImportRule, ImportRuleBudget, ImportRuleItem } from '@/api/import-rules'
import {
  getAddConditionReason,
  getCreateRuleReason,
} from '@/pages/settings/components/import-rules-section/utils/budget'

const text = { kind: 'condition', attribute: 'description', operator: 'contains', value: 'a' } as const

function ruleHolding(conditions: ImportRuleItem[]): ImportRule {
  return {
    id: 'rule-1',
    name: 'Market',
    position: 0,
    match: 'all',
    conditions,
    merchant: null,
    category: null,
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('the reason Create rule is unavailable', () => {
  it('is given once the rules hold the whole budget, with the limit the server sent', () => {
    expect(getCreateRuleReason({ limit: 100, used: 100 })).toBe(
      'Your import rules already hold 100 conditions, the most allowed',
    )
    expect(getCreateRuleReason({ limit: 7, used: 7 })).toBe(
      'Your import rules already hold 7 conditions, the most allowed',
    )
  })

  it('is absent while one condition is left, and while the budget is not known', () => {
    expect(getCreateRuleReason({ limit: 100, used: 99 })).toBeNull()
    expect(getCreateRuleReason(undefined)).toBeNull()
  })
})

describe('the reason the editor can not add a condition', () => {
  const budget: ImportRuleBudget = { limit: 100, used: 90 }

  it('counts the conditions of the other rules and those in the editor, and says so once they reach the limit', () => {
    // A new rule: nothing saved, so every one of the 90 belongs to another rule
    expect(getAddConditionReason(budget, null, 9)).toBeNull()
    expect(getAddConditionReason(budget, null, 10)).toBe('Your import rules can hold 100 conditions in all')
    expect(getAddConditionReason(budget, null, 11)).toBe('Your import rules can hold 100 conditions in all')
  })

  it('counts the conditions a saved rule holds once, not as saved and again as in the editor', () => {
    const saved = ruleHolding([text, text, text, text, text])

    // 85 belong to other rules, so a rule being edited may reach 15
    expect(getAddConditionReason(budget, saved, 14)).toBeNull()
    expect(getAddConditionReason(budget, saved, 15)).toBe('Your import rules can hold 100 conditions in all')
  })

  it('counts the conditions inside a saved rule group, and a group for nothing', () => {
    const saved = ruleHolding([text, { kind: 'group', match: 'any', conditions: [text, text, text] }])

    // 4 conditions are saved in this rule, so 86 belong to others
    expect(getAddConditionReason(budget, saved, 13)).toBeNull()
    expect(getAddConditionReason(budget, saved, 14)).not.toBeNull()
  })

  it('says nothing while the budget is not known, so the server decides', () => {
    expect(getAddConditionReason(undefined, null, 500)).toBeNull()
  })

  it('takes the limit from the server for the figure in its words', () => {
    expect(getAddConditionReason({ limit: 12, used: 12 }, null, 0)).toBe(
      'Your import rules can hold 12 conditions in all',
    )
  })
})
