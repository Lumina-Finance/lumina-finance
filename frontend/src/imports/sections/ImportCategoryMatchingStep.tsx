import { CREATE_CATEGORY_VALUE } from '../constants'
import { EmptyState, ImportStep, ValueMatchTable } from '../components'
import type { TransactionImportWorkflow } from '../hooks'
import { getCategoryMatchKind, isExistingCategoryMatch } from '../utils'

type ImportCategoryMatchingStepProps = Pick<
  TransactionImportWorkflow,
  | 'importedCategories'
  | 'resolvedCategoryMappings'
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
        <ValueMatchTable
          sourceLabel="Category From File"
          detailLabel="Type"
          targetLabel="Existing Category"
          createValue={CREATE_CATEGORY_VALUE}
          rows={importedCategories.map((category) => ({
            id: category,
            source: category,
            detailKind: getCategoryMatchKind(
              resolvedCategoryMappings[category] ?? '',
              categoryCreateKinds[category],
              categoryTypesBySource[category],
              categoryById,
            ),
            detailDisabled: isExistingCategoryMatch(resolvedCategoryMappings[category] ?? ''),
            onDetailKindChange: (kind) => setCategoryCreateKinds((current) => ({ ...current, [category]: kind })),
            value: resolvedCategoryMappings[category] ?? '',
            onChange: (value) => setCategoryMappings((current) => ({ ...current, [category]: value })),
          }))}
          options={categoryMatchOptions}
          disabled={categoriesLoading}
        />
      )}
    </ImportStep>
  )
}
