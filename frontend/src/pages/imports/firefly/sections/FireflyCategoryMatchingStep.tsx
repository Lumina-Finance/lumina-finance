import {
  CATEGORIES_LOAD_FAILURE_EXPLANATION,
  CATEGORIES_LOAD_FAILURE_TITLE,
  CREATE_CATEGORY_VALUE,
} from '@/pages/imports/constants'
import { EmptyState, ImportLoadFailure, ImportStep, ImportValueMatchTable } from '@/pages/imports/components'
import type { FireflyImportWorkflow } from '@/pages/imports/firefly/hooks'

type FireflyCategoryMatchingStepProps = Pick<
  FireflyImportWorkflow,
  | 'importedCategories'
  | 'resolvedCategoryMappings'
  | 'autoFilledCategories'
  | 'resolvedCategoryKinds'
  | 'categoryById'
  | 'setCategoryCreateKinds'
  | 'setCategoryMappings'
  | 'categoryMatchOptions'
  | 'categoriesLoading'
  | 'categoriesFailed'
  | 'refetchCategories'
>

/**
 * Category matching step of the Firefly III import flow, showing every category found in the export
 * matched to an existing category or queued to be created with a chosen kind
 */
export function FireflyCategoryMatchingStep({
  importedCategories,
  resolvedCategoryMappings,
  autoFilledCategories,
  resolvedCategoryKinds,
  categoryById,
  setCategoryCreateKinds,
  setCategoryMappings,
  categoryMatchOptions,
  categoriesLoading,
  categoriesFailed,
  refetchCategories,
}: FireflyCategoryMatchingStepProps) {
  return (
    <ImportStep
      index="03"
      title="Category Matching"
      description="Exported category names matched an existing category where possible. The rest are queued as new categories."
    >
      {categoriesFailed ? (
        <ImportLoadFailure
          title={CATEGORIES_LOAD_FAILURE_TITLE}
          description={CATEGORIES_LOAD_FAILURE_EXPLANATION}
          onRetry={refetchCategories}
        />
      ) : importedCategories.length === 0 ? (
        <EmptyState
          title="No imported categories detected"
          description="Upload the transactions CSV first."
        />
      ) : (
        <ImportValueMatchTable
          sourceLabel="Category From Export"
          detailLabel="Type"
          targetLabel="Existing Category"
          createValue={CREATE_CATEGORY_VALUE}
          rows={importedCategories.map((source) => {
            const value = resolvedCategoryMappings[source] ?? ''
            const existingMatch = Boolean(value) && value !== CREATE_CATEGORY_VALUE
            const detailKind = existingMatch
              ? categoryById.get(value)?.kind ?? ''
              : resolvedCategoryKinds[source] ?? ''

            return {
              id: source,
              source,
              autoFilled: autoFilledCategories.has(source),
              detailKind,
              detailDisabled: existingMatch,
              onDetailKindChange: (kind) => setCategoryCreateKinds((current) => ({ ...current, [source]: kind })),
              value,
              onChange: (nextValue) => setCategoryMappings((current) => ({ ...current, [source]: nextValue })),
            }
          })}
          options={categoryMatchOptions}
          disabled={categoriesLoading}
        />
      )}
    </ImportStep>
  )
}
