/**
 * Tests the budget attention thresholds, so which label a usage percentage earns cannot drift at the
 * boundaries between them
 */
import { describe, expect, it } from 'vitest'
import { getTopBudgetAttentionState } from '@/pages/dashboard/utils/getTopBudgetAttentionState'

describe('top budget attention state', () => {
  it('maps attention thresholds to their labels', () => {
    expect(getTopBudgetAttentionState(79).label).toBe('On track')
    expect(getTopBudgetAttentionState(80).label).toBe('Watch')
    expect(getTopBudgetAttentionState(100).label).toBe('Needs attention')
  })
})
