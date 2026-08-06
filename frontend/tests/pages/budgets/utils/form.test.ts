/**
 * Tests the budget form comparison helper, so a reordered category selection is not mistaken for a
 * changed one
 */
import { describe, expect, it } from 'vitest'
import { sameStringSet } from '@/pages/budgets/utils/form'

describe('budget form helpers', () => {
  it('compares selected category IDs without depending on order', () => {
    expect(sameStringSet(['travel', 'groceries'], ['groceries', 'travel'])).toBe(true)
    expect(sameStringSet(['travel'], ['travel', 'groceries'])).toBe(false)
  })
})
