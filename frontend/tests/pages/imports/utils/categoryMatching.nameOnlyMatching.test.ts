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

describe('scoring a source against a category by more than an exact match', () => {
  // The contains rule needs four characters and the shared-word rule needs half of them, so a
  // three-letter source matches nothing and the value comes up present but unanswered
  it('leaves a three-letter source unmatched against a category it barely touches', () => {
    const fuel: Category = { ...PERSONAL_EXPENSE, id: 'fuel', name: 'Gas & Fuel' }

    expect(inferCategoryMappings(['Gas'], {}, [fuel])).toEqual({ Gas: '' })
  })

  it('matches a source punctuated with an ampersand against a category spelling it out', () => {
    const category: Category = { ...PERSONAL_EXPENSE, id: 'household', name: 'Groceries and Household' }

    expect(inferCategoryMappings(['Groceries & Household'], {}, [category]))
      .toEqual({ 'Groceries & Household': 'household' })
  })

  it('matches a source carrying an accent against a category written without one', () => {
    const category: Category = { ...PERSONAL_EXPENSE, id: 'cafe', name: 'Cafe' }

    expect(inferCategoryMappings(['Café'], {}, [category])).toEqual({ 'Café': 'cafe' })
  })

  it('matches a source and a category naming the same words in a different order', () => {
    const category: Category = { ...PERSONAL_EXPENSE, id: 'dining', name: 'Out Dining' }

    expect(inferCategoryMappings(['Dining Out'], {}, [category])).toEqual({ 'Dining Out': 'dining' })
  })

  it('drops a stored answer for a source the file no longer carries', () => {
    const result = inferCategoryMappings(['Bonus'], { Vanished: 'some-id' }, [PERSONAL_INCOME])

    expect(result).not.toHaveProperty('Vanished')
    expect(result).toEqual({ Bonus: 'personal-income' })
  })

  it('keeps a blank source present and unmatched', () => {
    expect(inferCategoryMappings(['   '], {}, [PERSONAL_INCOME])).toEqual({ '   ': '' })
  })
})
