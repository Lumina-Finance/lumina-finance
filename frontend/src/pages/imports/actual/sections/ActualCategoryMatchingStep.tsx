import { CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import { ImportInfoCard, ImportSegmentedToggle } from '@/pages/imports/components'
import { ImportCategoryMatchingLayout, type ImportCategoryMatchRow } from '@/pages/imports/sections'
import type { Category } from '@/api/categories'
import type { ActualImportWorkflow } from '@/pages/imports/actual/hooks'
import { ACTUAL_CREDIT_PAYMENT_CATEGORY_SOURCE, getActualPaymentsHelp } from '@/pages/imports/actual/constants'
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

const CREDIT_PAYMENTS_HELP = "Transfers without a category in Actual from your other accounts into a credit card, line of credit or HELOC, going by the account types under Account Mapping. They're imported under Credit Card Payment on both accounts, so they don't count as spending, since the purchases already counted when you made them."

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

  // Payments filed in their category take one of its own kind, so the row can never quietly turn them
  // back into transfers while its toggle says otherwise
  const kindOptions = (kind: Category['kind']) => categoryMatchOptions.filter((option) => (
    option.value === CREATE_CATEGORY_VALUE || categoryById.get(option.value)?.kind === kind
  ))

  const rows: ImportCategoryMatchRow[] = visibleCategorySources.map((source) => {
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
        ? { label: `What ${source.label} means`, content: getActualPaymentsHelp(categoryName, source.isIncome) }
        : source.id === ACTUAL_CREDIT_PAYMENT_CATEGORY_SOURCE
          ? { label: `What ${source.label} means`, content: CREDIT_PAYMENTS_HELP }
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
      options: !isTransfer ? undefined : paymentMode === 'category' ? kindOptions(source.isIncome ? 'income' : 'expense') : transferOptions,
    }
  })

  return (
    <ImportCategoryMatchingLayout
      index="03"
      description="Actual categories matched an existing category where possible. The rest are queued as new categories."
      sourceLabel="Category From Actual"
      empty={budget
        ? { title: 'No categories to match', description: 'No imported row or budget uses a category of its own.' }
        : { title: 'No imported categories detected', description: 'Upload the budget export first.' }}
      rows={rows}
      options={categoryMatchOptions}
      categoriesLoading={categoriesLoading}
      categoriesFailed={categoriesFailed}
      refetchCategories={refetchCategories}
    >
      {budget && (
        <ImportInfoCard title="Transfers and debt payments">
          Money you move between your own accounts is a transfer, so it doesn't count as spending or toward a budget. Paying your credit card works this way, since the purchases already counted when you made them. So does paying a loan or mortgage you track as an account, where only the interest counts as spending. If you'd rather not track the debt as an account, you can record the whole payment as an expense in Debt Payment.
        </ImportInfoCard>
      )}

      {hasCategorisedTransfers && (
        <ImportInfoCard title="Payments to off-budget accounts">
          In Actual, money moved between your budget and an off-budget account, like a loan payment, can have a category. Those rows are marked "transfers in Actual" and are imported as transfers. Transfers don't count as spending or income, so if you'd like these counted the way Actual did, switch the row to Expense, or to Income for an income category. The payment then counts in that category on your budget account, and the off-budget account still records it, so its balance stays right.
        </ImportInfoCard>
      )}
    </ImportCategoryMatchingLayout>
  )
}
