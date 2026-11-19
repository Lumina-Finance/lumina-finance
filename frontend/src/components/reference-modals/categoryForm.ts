import { CATEGORY_ICON_MAX_LENGTH, CATEGORY_NAME_MAX_LENGTH } from '@/api/categories'
import {
  CREATE_CATEGORY_ICON_REQUIRED_MESSAGE,
  CREATE_CATEGORY_NAME_REQUIRED_MESSAGE,
} from '@/components/reference-modals/createCategoryConstants'
import type { FieldProblems } from '@/utils/refusedSubmit'

export const CATEGORY_NAME_TOO_LONG_MESSAGE = 'Name is too long'
export const CATEGORY_ICON_TOO_LONG_MESSAGE = 'Icon is too long'

/**
 * Returns what is wrong with a category name's length, counted in characters as the backend counts them
 * and not in the units an emoji takes, or undefined when it fits
 */
export function getCategoryNameLengthProblem(name: string): string | undefined {
  return [...name].length > CATEGORY_NAME_MAX_LENGTH ? CATEGORY_NAME_TOO_LONG_MESSAGE : undefined
}

/**
 * Returns what is wrong with a category icon's length, counted as a name's is, or undefined when it fits
 */
export function getCategoryIconLengthProblem(icon: string): string | undefined {
  return [...icon].length > CATEGORY_ICON_MAX_LENGTH ? CATEGORY_ICON_TOO_LONG_MESSAGE : undefined
}

/**
 * Validates the fields the backend requires when a category is created
 *
 * @param form - The icon as chosen and the name as typed. The name is trimmed here as it is when sent
 */
export function validateCategoryForm(form: { icon: string; name: string }): FieldProblems<'icon' | 'name'> {
  const name = form.name.trim()
  return {
    icon: form.icon ? getCategoryIconLengthProblem(form.icon) : CREATE_CATEGORY_ICON_REQUIRED_MESSAGE,
    name: name ? getCategoryNameLengthProblem(name) : CREATE_CATEGORY_NAME_REQUIRED_MESSAGE,
  }
}
