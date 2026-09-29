import {
  CLEARED_CATEGORY_SOURCES_EXPLANATION,
  CLEARED_CATEGORY_SOURCES_TITLE,
} from '@/pages/imports/constants'
import { ImportNotice } from '@/pages/imports/components'
import type { TransactionImportWorkflow } from '@/pages/imports/hooks'
import { getCategoryMatchKind, isExistingCategoryMatch } from '@/pages/imports/utils'
import { ImportCategoryMatchingLayout } from './ImportCategoryMatchingLayout'

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
 * mapped column
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
    <ImportCategoryMatchingLayout
      index="04"
      description="Match each category in the file to one of yours, or queue a new one."
      sourceLabel="Category From File"
      empty={{ title: 'No categories yet', description: 'Map the column holding the category first.' }}
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
      categoriesLoading={categoriesLoading}
      categoriesFailed={categoriesFailed}
      refetchCategories={refetchCategories}
    >
      {/* Shown only beside the categories it names, so neither a load failure nor an empty step
          carries it */}
      {!categoriesFailed && importedCategories.length > 0 && clearedCategorySourceLabels.length > 0 && (
        <ImportNotice title={CLEARED_CATEGORY_SOURCES_TITLE} items={clearedCategorySourceLabels}>
          {CLEARED_CATEGORY_SOURCES_EXPLANATION}
        </ImportNotice>
      )}
    </ImportCategoryMatchingLayout>
  )
}
