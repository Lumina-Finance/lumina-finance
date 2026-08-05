import { CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import { EmptyState, ImportStep, ImportValueMatchTable } from '@/pages/imports/components'
import type { TransactionImportWorkflow } from '@/pages/imports/hooks'
import { getCategoryMatchKind, isExistingCategoryMatch } from '@/pages/imports/utils'

type ImportCategoryMatchingStepProps = Pick<
  TransactionImportWorkflow,
  | 'importedCategories'
  | 'categoryMappings'
  | 'autoFilledCategories'
  | 'categoryCreateKinds'
  | 'categoryTypesBySource'
  | 'categoryById'
  | 'setCategoryCreateKinds'
  | 'setCategoryMappings'
  | 'categoryMatchOptions'
  | 'categoriesLoading'
>

/**
 * Category matching step of the generic CSV import flow, showing every category value found in the
 * mapped column matched to an existing category or queued to be created with a chosen kind
 */
export function ImportCategoryMatchingStep({
  importedCategories,
  categoryMappings,
  autoFilledCategories,
  categoryCreateKinds,
  categoryTypesBySource,
  categoryById,
  setCategoryCreateKinds,
  setCategoryMappings,
  categoryMatchOptions,
  categoriesLoading,
}: ImportCategoryMatchingStepProps) {
  return (
    <ImportStep
      index="04"
      title="Category Matching"
      description="Manually match imported category values to existing categories, or queue new ones."
    >
      {importedCategories.length === 0 ? (
        <EmptyState
          title="No imported categories detected"
          description="Map a category column first."
        />
      ) : (
        <ImportValueMatchTable
          sourceLabel="Category From File"
          detailLabel="Type"
          targetLabel="Existing Category"
          createValue={CREATE_CATEGORY_VALUE}
          rows={importedCategories.map((category) => {
            const value = categoryMappings[category] ?? ''
            const detailKind = getCategoryMatchKind(
              value,
              categoryCreateKinds[category],
              categoryTypesBySource[category],
              categoryById,
            )
            const existingMatch = isExistingCategoryMatch(value)

            return {
              id: category,
              source: category,
              autoFilled: autoFilledCategories.has(category),
              detailAutoFilled: !existingMatch && !categoryCreateKinds[category] && Boolean(detailKind),
              detailKind,
              detailDisabled: existingMatch,
              onDetailKindChange: (kind) => setCategoryCreateKinds((current) => ({ ...current, [category]: kind })),
              value,
              onChange: (nextValue) => setCategoryMappings((current) => ({ ...current, [category]: nextValue })),
            }
          })}
          options={categoryMatchOptions}
          disabled={categoriesLoading}
        />
      )}
    </ImportStep>
  )
}
