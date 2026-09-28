import {
  CATEGORIES_LOAD_FAILURE_EXPLANATION,
  CATEGORIES_LOAD_FAILURE_TITLE,
  CREATE_CATEGORY_VALUE,
} from '@/pages/imports/constants'
import { EmptyState, ImportInfoCard, ImportLoadFailure, ImportStep, ImportValueMatchTable } from '@/pages/imports/components'
import type { ActualImportWorkflow } from '@/pages/imports/actual/hooks'
import { getActualTransferCategoryOptions } from '@/pages/imports/actual/utils/categories'
import { getActualCategoryName } from '@/pages/imports/actual/utils/normalise'

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
 * Payments between the budget and an off-budget account carry the category as a transfer, so their
 * rows can only take a transfer category, which is created as one
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
  const hasCategorisedTransfers = categorySources.some((source) => source.role === 'transfer' && source.categoryId)
  const categoryByActualId = new Map(budget?.categories.map((category) => [category.id, category]))

  return (
    <ImportStep
      index="03"
      title="Category Matching"
      description="Actual categories matched an existing category where possible. The rest are queued as new categories."
    >
      {hasCategorisedTransfers && (
        <ImportInfoCard title="Payments to off-budget accounts">
          Categories marked (transfers) hold payments to and from off-budget accounts that carried a category in Actual, such as a loan payment. They take a transfer category, and a budget for that category still counts them. A payment whose other side is in the file stays a transfer between your accounts. One whose other side isn't comes in on its own, as a withdrawal or deposit.
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
            const category = isTransfer ? categoryByActualId.get(source.categoryId ?? '') : undefined
            const categoryName = category && budget ? getActualCategoryName(category, budget.categories) : ''

            return {
              id: source.id,
              source: source.label,
              sourceHelp: categoryName
                ? {
                    label: `What ${source.label} means`,
                    content: `In Actual, these are transfers between a budget account and an off-budget account, like a loan, that you gave the ${categoryName} category. Lumina Finance keeps them as transfers, so they need a transfer category. A ${categoryName} budget still counts them.`,
                  }
                : undefined,
              autoFilled: autoFilledCategories.has(source.id),
              detailKind: existingMatch ? categoryById.get(value)?.kind ?? '' : resolvedCategoryKinds[source.id] ?? '',
              detailDisabled: existingMatch || isTransfer,
              onDetailKindChange: (kind) => setCategoryCreateKinds((current) => ({ ...current, [source.id]: kind })),
              value,
              onChange: (nextValue) => setCategoryMappings((current) => ({ ...current, [source.id]: nextValue })),
              options: isTransfer ? getActualTransferCategoryOptions(categoryMatchOptions, categoryById, source) : undefined,
            }
          })}
          options={categoryMatchOptions}
          disabled={categoriesLoading}
        />
      )}
    </ImportStep>
  )
}
