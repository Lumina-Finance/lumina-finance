/**
 * Covers the merchant distribution's category filter helpers
 *
 * Guards the map offering only expense categories, and a category merged away in another tab
 * never leaving the map narrowed by a choice the user can no longer see or clear
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import { getMerchantCategoryOptions, keepExistingCategoryIds } from '@/pages/insights/utils/merchantCategoryFilter'

function category(id: string, name: string, kind: Category['kind'], icon: string | null = null): Category {
  return {
    id,
    group_id: null,
    owner_id: 'user',
    name,
    kind,
    icon,
    is_system: false,
    created_at: '2026-01-01T00:00:00Z',
  }
}

describe('getMerchantCategoryOptions', () => {
  it('offers expense categories only, sorted by name, with a fallback icon', () => {
    const options = getMerchantCategoryOptions([
      category('rent', 'Rent', 'expense', '🏠'),
      category('salary', 'Salary', 'income'),
      category('moves', 'Account transfer', 'transfer'),
      category('food', 'Food', 'expense'),
    ])

    expect(options.map((option) => option.value)).toEqual(['food', 'rent'])
    expect(options[0].icon).not.toBeNull()
    expect(options[1].icon).toBe('🏠')
    expect(options.every((option) => option.group === undefined)).toBe(true)
  })

  it('offers nothing before the categories load', () => {
    expect(getMerchantCategoryOptions(undefined)).toEqual([])
  })
})

describe('keepExistingCategoryIds', () => {
  const options = [
    { value: 'food', label: 'Food' },
    { value: 'rent', label: 'Rent' },
  ]

  it('drops a chosen category that no longer exists once categories have loaded', () => {
    expect(keepExistingCategoryIds(['food', 'gone'], options, true)).toEqual(['food'])
  })

  it('keeps every choice while categories are still loading', () => {
    expect(keepExistingCategoryIds(['food', 'gone'], [], false)).toEqual(['food', 'gone'])
  })

  it('returns the same list when every choice still exists', () => {
    const chosen = ['food', 'rent']
    expect(keepExistingCategoryIds(chosen, options, true)).toBe(chosen)
  })
})
