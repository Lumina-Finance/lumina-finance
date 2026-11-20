export interface Category {
  id: string
  group_id: string | null
  owner_id: string | null
  name: string
  kind: 'expense' | 'income' | 'transfer'
  icon: string | null
  is_system: boolean
  created_at: string
}

export interface UpdateCategoryPayload {
  name?: string
  icon?: string | null
}

export interface CreateCategoryPayload {
  name: string
  kind: Category['kind']
  icon?: string | null
  group_id?: string | null
}

export interface MergeCategoryPayload {
  replacement_category_id: string
}

export interface UpdateCategoryRequest {
  categoryId: string
  payload: UpdateCategoryPayload
}

export interface MergeCategoryRequest {
  categoryId: string
  payload: MergeCategoryPayload
}

/**
 * Characters a category's name and icon may hold, matching the backend. The icon's room is for an
 * emoji with skin tone and joiner sequences
 */
export const CATEGORY_NAME_MAX_LENGTH = 256
export const CATEGORY_ICON_MAX_LENGTH = 32
