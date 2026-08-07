/**
 * Tests which existing category the import suggests for a value in the file, now that the direction
 * read from the amounts no longer narrows the candidates, and which one wins where several read the
 * same across scopes
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import { findReusedImportCategory, inferCategoryMappings } from '@/pages/imports/utils'

const PERSONAL_EXPENSE: Category = {
  id: 'personal-expense',
  group_id: null,
  owner_id: 'user-1',
  name: 'Bonus',
  kind: 'expense',
  icon: null,
  is_system: false,
  created_at: '2026-01-01T00:00:00Z',
}

const PERSONAL_INCOME: Category = { ...PERSONAL_EXPENSE, id: 'personal-income', kind: 'income' }
const GROUP_INCOME: Category = {
  ...PERSONAL_EXPENSE,
  id: 'group-income',
  owner_id: null,
  group_id: 'group-1',
  kind: 'income',
}
const SYSTEM_INCOME: Category = {
  ...PERSONAL_EXPENSE,
  id: 'system-income',
  owner_id: null,
  is_system: true,
  kind: 'income',
}

describe('suggesting a category for a value in the file', () => {
  it('suggests a category recording the other direction', () => {
    // A file of Bonus rows carrying minus signs still means the user's income category called Bonus,
    // since a category's direction does not bound the signs of the rows filed under it
    expect(inferCategoryMappings(['Bonus'], {}, [PERSONAL_INCOME])).toEqual({ Bonus: 'personal-income' })
  })

  it('suggests the user own category over one their group shares', () => {
    expect(inferCategoryMappings(['Bonus'], {}, [GROUP_INCOME, PERSONAL_EXPENSE]))
      .toEqual({ Bonus: 'personal-expense' })
  })

  it('suggests a group category over one that ships with the app', () => {
    expect(inferCategoryMappings(['Bonus'], {}, [SYSTEM_INCOME, GROUP_INCOME])).toEqual({ Bonus: 'group-income' })
  })

  it('suggests nothing where two of the user own categories score the same', () => {
    const second: Category = { ...PERSONAL_EXPENSE, id: 'second-personal' }

    expect(inferCategoryMappings(['Bonus'], {}, [PERSONAL_EXPENSE, second])).toEqual({ Bonus: '' })
  })

  it('suggests the category spelled as the file spells it over one differing in its spaces', () => {
    // Both read as the same words, and the direction read off the amounts used to be what separated
    // an expense "Pet Care" from an income "Petcare". Scored equally they would tie and the value
    // would come up unanswered, so the one matching space for space wins
    const spaced: Category = { ...PERSONAL_EXPENSE, id: 'spaced', name: 'Pet Care' }
    const compact: Category = { ...PERSONAL_INCOME, id: 'compact', name: 'Petcare' }

    expect(inferCategoryMappings(['Pet Care'], {}, [compact, spaced])).toEqual({ 'Pet Care': 'spaced' })
    expect(inferCategoryMappings(['Petcare'], {}, [compact, spaced])).toEqual({ Petcare: 'compact' })
  })

  it('leaves an answer the user gave alone', () => {
    expect(inferCategoryMappings(['Bonus'], { Bonus: 'chosen-by-hand' }, [PERSONAL_INCOME]))
      .toEqual({ Bonus: 'chosen-by-hand' })
  })
})

describe('the category a create answer would land on', () => {
  it('matches whatever the capitals and surrounding spaces', () => {
    expect(findReusedImportCategory('  bonus ', [PERSONAL_INCOME])?.id).toBe('personal-income')
  })

  it('leaves out a group category, which the commit does not reuse', () => {
    expect(findReusedImportCategory('Bonus', [GROUP_INCOME])).toBeUndefined()
  })

  it('takes the user own category over one that ships with the app', () => {
    expect(findReusedImportCategory('Bonus', [SYSTEM_INCOME, PERSONAL_EXPENSE])?.id).toBe('personal-expense')
  })
})
