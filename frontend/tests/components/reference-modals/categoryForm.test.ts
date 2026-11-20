/**
 * Guards the category form's name and icon fields. A category is stored once and returned on every
 * category list, so a value past the backend's limit is refused on its own field before anything is sent
 */
import { describe, expect, it } from 'vitest'
import {
  CATEGORY_ICON_TOO_LONG_MESSAGE,
  CATEGORY_NAME_TOO_LONG_MESSAGE,
  getCategoryNameLengthProblem,
  validateCategoryForm,
} from '@/components/reference-modals/categoryForm'

const FAMILY_EMOJI = '👨‍👩‍👧‍👦'

describe('the category icon field', () => {
  it.each([
    { name: 'a basket', icon: '🛒', problem: undefined },
    { name: 'a joined family emoji', icon: FAMILY_EMOJI, problem: undefined },
    { name: 'exactly 32 characters', icon: 'x'.repeat(32), problem: undefined },
    { name: 'one character past the limit', icon: 'x'.repeat(33), problem: CATEGORY_ICON_TOO_LONG_MESSAGE },
    { name: '40 characters', icon: 'x'.repeat(40), problem: CATEGORY_ICON_TOO_LONG_MESSAGE },
    { name: 'no icon chosen', icon: '', problem: 'Choose an icon' },
  ])('gives the right message for $name', ({ icon, problem }) => {
    expect(validateCategoryForm({ icon, name: 'Groceries' }).icon).toBe(problem)
  })

  it('counts an icon in characters, as the backend does, and not in the units each takes', () => {
    // 32 emoji take 64 units, and 4 family emoji take 44 units but 28 characters
    expect(validateCategoryForm({ icon: '😀'.repeat(32), name: 'Groceries' }).icon).toBeUndefined()
    expect(validateCategoryForm({ icon: '😀'.repeat(33), name: 'Groceries' }).icon).toBe(CATEGORY_ICON_TOO_LONG_MESSAGE)
    expect(validateCategoryForm({ icon: FAMILY_EMOJI.repeat(4), name: 'Groceries' }).icon).toBeUndefined()
    expect(validateCategoryForm({ icon: FAMILY_EMOJI.repeat(5), name: 'Groceries' }).icon).toBe(
      CATEGORY_ICON_TOO_LONG_MESSAGE,
    )
  })
})

describe('the category name field', () => {
  it.each([
    { name: 'a short name', value: 'Groceries', problem: undefined },
    { name: 'exactly 256 characters', value: 'n'.repeat(256), problem: undefined },
    { name: '256 characters with spaces around them', value: `  ${'n'.repeat(256)}  `, problem: undefined },
    { name: 'one character past the limit', value: 'n'.repeat(257), problem: CATEGORY_NAME_TOO_LONG_MESSAGE },
    { name: '300 characters', value: 'n'.repeat(300), problem: CATEGORY_NAME_TOO_LONG_MESSAGE },
    { name: 'spaces only', value: '   ', problem: 'Name is required' },
  ])('gives the right message for $name', ({ value, problem }) => {
    expect(validateCategoryForm({ icon: '🛒', name: value }).name).toBe(problem)
  })

  it('counts emoji as characters, as the backend does, not as the units they take', () => {
    expect(getCategoryNameLengthProblem('😀'.repeat(256))).toBeUndefined()
    expect(getCategoryNameLengthProblem('😀'.repeat(257))).toBe(CATEGORY_NAME_TOO_LONG_MESSAGE)
  })
})
