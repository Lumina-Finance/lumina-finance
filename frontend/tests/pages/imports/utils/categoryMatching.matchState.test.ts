/**
 * Tests the small pieces the category matching step is built from: which sources keep their
 * current answers when the imported list changes, what kind a matched category counts as, and
 * whether a selection points at a category that already exists
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import { CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import { getCategoryMatchKind, isExistingCategoryMatch, keepCurrentMatchMap } from '@/pages/imports/utils'

/**
 * Creates a category fixture, defaulting to one the user owns
 */
function createCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: overrides.id ?? 'cat-1',
    group_id: null,
    owner_id: 'user-1',
    name: overrides.name ?? 'Groceries',
    kind: overrides.kind ?? 'expense',
    icon: null,
    is_system: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('keeping a match map in step with the imported sources', () => {
  // Losing this identity re-runs the category step on every render
  it('returns the same object when nothing changed', () => {
    const current = { a: 'x' }

    expect(keepCurrentMatchMap(current, ['a'])).toBe(current)
  })

  it('drops a source the file no longer carries', () => {
    expect(keepCurrentMatchMap({ a: 'x', b: 'y' }, ['a'])).toEqual({ a: 'x' })
  })

  it('adds a blank answer for a new source', () => {
    expect(keepCurrentMatchMap({ a: 'x' }, ['a', 'b'])).toEqual({ a: 'x', b: '' })
  })

  // The length check alone cannot catch this: one source is dropped and one is added, so the count
  // stays the same while the sources themselves have changed
  it('rebuilds the map when the source list changes without changing size', () => {
    expect(keepCurrentMatchMap({ a: 'x', b: 'y' }, ['a', 'c'])).toEqual({ a: 'x', c: '' })
  })
})

describe('working out what kind a matched category counts as', () => {
  const NO_CATEGORIES = new Map<string, Category>()

  // A chosen category outranks both other arguments even when the map does not hold it, so a
  // fall-through would show a kind the commit will not use
  it('reads nothing for a selection the map does not hold', () => {
    expect(getCategoryMatchKind('cat-1', 'income', 'Income', NO_CATEGORIES)).toBe('')
  })

  it('takes the kind off the selected category', () => {
    const categoryById = new Map([['cat-1', createCategory({ kind: 'expense' })]])

    expect(getCategoryMatchKind('cat-1', undefined, 'Income', categoryById)).toBe('expense')
  })

  it('falls back to the chosen create kind for a queued category', () => {
    expect(getCategoryMatchKind(CREATE_CATEGORY_VALUE, 'transfer', 'Expense', NO_CATEGORIES)).toBe('transfer')
  })

  it('falls back to the type inferred from the amounts when no kind is chosen', () => {
    expect(getCategoryMatchKind('', undefined, 'Transfer', NO_CATEGORIES)).toBe('transfer')
    expect(getCategoryMatchKind('', undefined, 'Income', NO_CATEGORIES)).toBe('income')
  })

  // The second case fails on its own if the decode stops being case sensitive
  it('reads nothing from a type label it does not recognise', () => {
    expect(getCategoryMatchKind('', undefined, 'Mixed', NO_CATEGORIES)).toBe('')
    expect(getCategoryMatchKind('', undefined, 'expense', NO_CATEGORIES)).toBe('')
  })
})

describe('whether a selection points at a category that already exists', () => {
  it('accepts a real category id', () => {
    expect(isExistingCategoryMatch('cat-1')).toBe(true)
  })

  it('refuses the create-new placeholder', () => {
    expect(isExistingCategoryMatch(CREATE_CATEGORY_VALUE)).toBe(false)
  })

  it('refuses nothing selected at all', () => {
    expect(isExistingCategoryMatch('')).toBe(false)
  })
})
