export type {
  Category,
  CreateCategoryPayload,
  MergeCategoryPayload,
  MergeCategoryRequest,
  UpdateCategoryPayload,
  UpdateCategoryRequest,
} from '@/api/categories/types'

export { CATEGORY_ICON_MAX_LENGTH, CATEGORY_NAME_MAX_LENGTH } from '@/api/categories/types'

export {
  createCategory,
  deleteCategory,
  fetchCategories,
  mergeCategory,
  updateCategory,
} from '@/api/categories/requests'

export {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useForgetCategory,
  useMergeCategory,
  useUpdateCategory,
} from '@/api/categories/hooks'
