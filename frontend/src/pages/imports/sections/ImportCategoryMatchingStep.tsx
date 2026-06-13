import { CREATE_CATEGORY_VALUE } from '../constants'
import { EmptyState, ImportStep, ImportValueMatchTable } from '../components'
import type { TransactionImportWorkflow } from '../hooks'
import { getCategoryMatchKind, isExistingCategoryMatch } from '../utils'

type ImportCategoryMatchingStepProps = Pick<
  TransactionImportWorkflow,
  | 'importedCategories'
  | 'resolvedCategoryMappings'
  | 'autoFilledCategories'
  | 'categoryCreateKinds'
  | 'categoryTypesBySource'
  | 'categoryById'
  | 'setCategoryCreateKinds'
  | 'setCategoryMappings'
  | 'categoryMatchOptions'
  | 'categoriesLoading'
>

export function ImportCategoryMatchingStep({
  importedCategories,
  resolvedCategoryMappings,
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
            const value = resolvedCategoryMappings[category] ?? ''
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
