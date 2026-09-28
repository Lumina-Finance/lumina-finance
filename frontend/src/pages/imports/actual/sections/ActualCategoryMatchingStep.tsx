import {
  CATEGORIES_LOAD_FAILURE_EXPLANATION,
  CATEGORIES_LOAD_FAILURE_TITLE,
  CREATE_CATEGORY_VALUE,
} from '@/pages/imports/constants'
import {
  EmptyState,
  ImportInfoCard,
  ImportLoadFailure,
  ImportSegmentedToggle,
  ImportStep,
  ImportValueMatchTable,
} from '@/pages/imports/components'
import type { ActualImportWorkflow } from '@/pages/imports/actual/hooks'
import type { ActualCategorySource, ActualPaymentMode } from '@/pages/imports/actual/types'
import { getActualTransferCategoryOptions } from '@/pages/imports/actual/utils/categories'
import { getActualCategoryName } from '@/pages/imports/actual/utils/normalise'

type ActualCategoryMatchingStepProps = Pick<
  ActualImportWorkflow,
  | 'budget'
  | 'visibleCategorySources'
  | 'paymentModes'
  | 'resolvedCategoryMappings'
  | 'autoFilledCategories'
  | 'resolvedCategoryKinds'
  | 'categoryById'
  | 'setCategoryCreateKinds'
  | 'setCategoryMappings'
  | 'setPaymentMode'
  | 'categoryMatchOptions'
  | 'categoriesLoading'
  | 'categoriesFailed'
  | 'refetchCategories'
>

function getPaymentModeOptions(source: ActualCategorySource): Array<{ value: ActualPaymentMode; label: string }> {
  return [
    { value: 'category', label: source.isIncome ? 'Income' : 'Expense' },
    { value: 'transfer', label: 'Transfer' },
  ]
}

function describePayments(source: ActualCategorySource, name: string) {
  const asCategory = source.isIncome
    ? `As Income, they're income in ${name}`
    : `As Expense, they're spending in ${name}, which its budget counts as Actual did`
  return `In Actual, these are payments between a budget account and an off-budget account, like a loan, that you gave the ${name} category. ${asCategory}, and the off-budget account's side stays a transfer. As Transfer, they stay transfers between your accounts, which budgets don't count.`
}

/**
 * Category matching step of the Actual Budget import flow, showing every category the imported rows
 * and budgets use, matched to an existing category or queued to be created with a chosen kind
 *
 * Payments between the budget and an off-budget account that carry a category get a row of their
 * own, which chooses whether they come in as spending or income in that category or as transfers.
 * As spending, the row answers for the category itself, sharing the answer of the category's own
 * row when it has one. As transfers, it takes a transfer category of its own
 */
export function ActualCategoryMatchingStep({
  budget,
  visibleCategorySources,
  paymentModes,
  resolvedCategoryMappings,
  autoFilledCategories,
  resolvedCategoryKinds,
  categoryById,
  setCategoryCreateKinds,
  setCategoryMappings,
  setPaymentMode,
  categoryMatchOptions,
  categoriesLoading,
  categoriesFailed,
  refetchCategories,
}: ActualCategoryMatchingStepProps) {
  const hasCategorisedTransfers = visibleCategorySources.some((source) => source.role === 'transfer' && source.categoryId)
  const categoryByActualId = new Map(budget?.categories.map((category) => [category.id, category]))
  const visibleIds = new Set(visibleCategorySources.map((source) => source.id))
  const transferOptions = getActualTransferCategoryOptions(categoryMatchOptions, categoryById)

  return (
    <ImportStep
      index="03"
      title="Category Matching"
      description="Actual categories matched an existing category where possible. The rest are queued as new categories."
    >
      {hasCategorisedTransfers && (
        <ImportInfoCard title="Payments to off-budget accounts">
          Categories marked (transfers) hold payments to and from off-budget accounts, like a loan payment, that carried a category in Actual. As Expense, or Income for an income category, the budget account's side is filed in that category, so its budget counts it as Actual did, and the off-budget account's side is a transfer. As Transfer, both sides stay transfers, which budgets don't count. A payment whose other side isn't in the file comes in on its own, as a withdrawal or deposit.
        </ImportInfoCard>
      )}

      {categoriesFailed ? (
        <ImportLoadFailure
          title={CATEGORIES_LOAD_FAILURE_TITLE}
          description={CATEGORIES_LOAD_FAILURE_EXPLANATION}
          onRetry={refetchCategories}
        />
      ) : visibleCategorySources.length === 0 ? (
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
          rows={visibleCategorySources.map((source) => {
            const isTransfer = source.role === 'transfer'
            const category = isTransfer ? categoryByActualId.get(source.categoryId ?? '') : undefined
            const categoryName = category && budget ? getActualCategoryName(category, budget.categories) : ''

            // A payment row filed as spending answers for its category's spending source, which is
            // named by Actual's category id
            const paymentMode: ActualPaymentMode | undefined = paymentModes[source.id]
            const mappingId = paymentMode === 'category' && source.categoryId ? source.categoryId : source.id
            const sharesVisibleRow = mappingId !== source.id && visibleIds.has(mappingId)
            const value = resolvedCategoryMappings[mappingId] ?? ''
            const existingMatch = Boolean(value) && value !== CREATE_CATEGORY_VALUE

            return {
              id: source.id,
              source: source.label,
              sourceHelp: categoryName
                ? { label: `What ${source.label} means`, content: describePayments(source, categoryName) }
                : undefined,

              // The category's own row already shows whether its answer was filled in or is new
              autoFilled: autoFilledCategories.has(mappingId) && !sharesVisibleRow,
              hideCreateBadge: sharesVisibleRow,
              detailKind: existingMatch ? categoryById.get(value)?.kind ?? '' : resolvedCategoryKinds[mappingId] ?? '',
              detailDisabled: existingMatch || isTransfer,
              detailNode: paymentMode
                ? (
                    <ImportSegmentedToggle
                      options={getPaymentModeOptions(source)}
                      value={paymentMode}
                      label={`Import ${source.label} as`}
                      onChange={(mode) => setPaymentMode(source.id, mode)}
                      disabled={categoriesLoading}
                    />
                  )
                : undefined,
              onDetailKindChange: (kind) => setCategoryCreateKinds((current) => ({ ...current, [mappingId]: kind })),
              value,
              onChange: (nextValue) => setCategoryMappings((current) => ({ ...current, [mappingId]: nextValue })),
              options: isTransfer && paymentMode !== 'category' ? transferOptions : undefined,
            }
          })}
          options={categoryMatchOptions}
          disabled={categoriesLoading}
        />
      )}
    </ImportStep>
  )
}
