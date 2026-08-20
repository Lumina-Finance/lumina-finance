import {
  CATEGORIES_LOAD_FAILURE_EXPLANATION,
  CATEGORIES_LOAD_FAILURE_TITLE,
  CLEARED_CATEGORY_SOURCES_EXPLANATION,
  CLEARED_CATEGORY_SOURCES_TITLE,
  CREATE_CATEGORY_VALUE,
} from '@/pages/imports/constants'
import { EmptyState, ImportLoadFailure, ImportNotice, ImportStep, ImportValueMatchTable } from '@/pages/imports/components'
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
  | 'categoriesFailed'
  | 'refetchCategories'
  | 'clearedCategorySourceLabels'
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
  categoriesFailed,
  refetchCategories,
  clearedCategorySourceLabels,
}: ImportCategoryMatchingStepProps) {
  return (
    <ImportStep
      index="04"
      title="Category Matching"
      description="Match each category in the file to one of yours, or queue a new one."
    >
      {categoriesFailed ? (
        <ImportLoadFailure
          title={CATEGORIES_LOAD_FAILURE_TITLE}
          description={CATEGORIES_LOAD_FAILURE_EXPLANATION}
          onRetry={refetchCategories}
        />
      ) : importedCategories.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Map the column holding the category first."
        />
      ) : (
        <>
        {clearedCategorySourceLabels.length > 0 && (
          <ImportNotice title={CLEARED_CATEGORY_SOURCES_TITLE} items={clearedCategorySourceLabels}>
            {CLEARED_CATEGORY_SOURCES_EXPLANATION}
          </ImportNotice>
        )}
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
        </>
      )}
    </ImportStep>
  )
}
