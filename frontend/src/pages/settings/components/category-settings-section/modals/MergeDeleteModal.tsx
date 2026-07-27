import { Tag } from 'lucide-react'
import type { Category } from '@/api/categories'
import MergeDeleteReferenceModal from '@/pages/settings/components/shared/modals/MergeDeleteReferenceModal'
import { DELETE_SPINNER_MS } from '@/pages/settings/components/category-settings-section/constants'
import { categoryMergeOptions } from '@/pages/settings/components/category-settings-section/utils'

/**
 * Modal shown when a category cannot be deleted because transactions still use it, asking
 * which category those transactions should move to before the original is removed
 *
 * The full category list is already loaded by the caller, so the dropdown filters it locally
 * rather than driving a remote search
 */
export default function MergeDeleteCategoryModal({
  category,
  categories,
  isPending,
  onClose,
  onMerge,
}: {
  category: Category
  categories: Category[]
  isPending: boolean
  onClose: () => void
  onMerge: (replacementCategoryId: string) => Promise<void>
}) {
  const resolveCategoryReplacements = () => ({
    replacements: categories,
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: () => {},
  })

  return (
    <MergeDeleteReferenceModal
      item={category}
      isPending={isPending}
      submitMinVisibleMs={DELETE_SPINNER_MS}
      filterOptionsLocally
      icon={Tag}
      buildOptions={categoryMergeOptions}
      useReplacementQuery={resolveCategoryReplacements}
      wording={{
        entityLabel: 'Category',
        fieldLabel: 'Replacement Category',
        description: `${category.name} is used by existing transactions. Choose another category for those transactions, then it can be deleted.`,
        selectSrLabel: 'Replacement category',
        searchPlaceholder: 'Search categories...',
        selectPlaceholder: 'Select category...',
        emptyOptionsPlaceholder: 'No compatible categories',
        requireSelectionError: 'Select a replacement category.',
        deleteErrorFallback: 'Failed to delete category.',
      }}
      onClose={onClose}
      onMerge={onMerge}
    />
  )
}
