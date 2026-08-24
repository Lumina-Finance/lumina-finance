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

  it('colours the dot apart from the words beside it, and leaves the amber state alone', () => {
    expect(getTopBudgetAttentionState(50)).toMatchObject({
      textColor: 'var(--app-positive)',
      indicatorColor: 'var(--app-chart-positive)',
    })
    expect(getTopBudgetAttentionState(100)).toMatchObject({
      textColor: 'var(--app-negative)',
      indicatorColor: 'var(--app-chart-negative)',
    })
    expect(getTopBudgetAttentionState(85)).toMatchObject({
      textColor: 'var(--app-warning-text)',
      indicatorColor: 'var(--app-warning)',
    })
  })
})
