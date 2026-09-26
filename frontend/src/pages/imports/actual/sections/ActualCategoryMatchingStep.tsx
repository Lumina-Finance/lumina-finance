import {
  CATEGORIES_LOAD_FAILURE_EXPLANATION,
  CATEGORIES_LOAD_FAILURE_TITLE,
  CREATE_CATEGORY_VALUE,
} from '@/pages/imports/constants'
import { EmptyState, ImportInfoCard, ImportLoadFailure, ImportStep, ImportValueMatchTable } from '@/pages/imports/components'
import type { ActualImportWorkflow } from '@/pages/imports/actual/hooks'
import { getActualTransferCategoryOptions } from '@/pages/imports/actual/utils/categories'

type ActualCategoryMatchingStepProps = Pick<
  ActualImportWorkflow,
  | 'budget'
  | 'categorySources'
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
 * Category matching step of the Actual Budget import flow, showing every category the imported rows
 * and budgets use, matched to an existing category or queued to be created with a chosen kind
 *
 * Payments between the budget and an off-budget account stay transfers, so their rows can only take
 * a transfer category, which is created as one
 */
export function ActualCategoryMatchingStep({
  budget,
  categorySources,
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
}: ActualCategoryMatchingStepProps) {
  const transferOptions = getActualTransferCategoryOptions(categoryMatchOptions, categoryById)
  const hasCategorisedTransfers = categorySources.some((source) => source.role === 'transfer' && source.categoryId)

  return (
    <ImportStep
      index="03"
      title="Category Matching"
      description="Actual categories matched an existing category where possible. The rest are queued as new categories."
    >
      {hasCategorisedTransfers && (
        <ImportInfoCard title="Payments to off-budget accounts">
          Rows marked as transfers to and from off-budget accounts are payments that carried a category in Actual, such as a loan payment. They stay transfers between your accounts, so they take a transfer category, and a budget for that category still counts them.
        </ImportInfoCard>
      )}

      {categoriesFailed ? (
        <ImportLoadFailure
          title={CATEGORIES_LOAD_FAILURE_TITLE}
          description={CATEGORIES_LOAD_FAILURE_EXPLANATION}
          onRetry={refetchCategories}
        />
      ) : categorySources.length === 0 ? (
        <EmptyState
          title={budget ? 'No categories to match' : 'No imported categories detected'}
          description={budget
            ? 'No imported row or budget uses a category of its own.'
            : 'Upload the budget export first.'}
        />
      ) : (
        <ImportValueMatchTable
          sourceLabel="Category From Actual"
          detailLabel="Type"
          targetLabel="Existing Category"
          createValue={CREATE_CATEGORY_VALUE}
          rows={categorySources.map((source) => {
            const value = resolvedCategoryMappings[source.id] ?? ''
            const existingMatch = Boolean(value) && value !== CREATE_CATEGORY_VALUE
            const isTransfer = source.role === 'transfer'

            return {
              id: source.id,
              source: source.label,
              autoFilled: autoFilledCategories.has(source.id),
              detailKind: existingMatch ? categoryById.get(value)?.kind ?? '' : resolvedCategoryKinds[source.id] ?? '',
              detailDisabled: existingMatch || isTransfer,
              onDetailKindChange: (kind) => setCategoryCreateKinds((current) => ({ ...current, [source.id]: kind })),
              value,
              onChange: (nextValue) => setCategoryMappings((current) => ({ ...current, [source.id]: nextValue })),
              options: isTransfer ? transferOptions : undefined,
            }
          })}
          options={categoryMatchOptions}
          disabled={categoriesLoading}
        />
      )}
    </ImportStep>
  )
}
