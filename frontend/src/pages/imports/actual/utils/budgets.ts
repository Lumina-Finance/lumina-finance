import type { ImportBudgetRecurrence, ImportRunBudgets } from '@/api/provider-imports'
import type { Category } from '@/api/categories'
import type { TransactionImportCategoryMapping } from '@/api/transaction-imports'
import {
  ACTUAL_BUDGET_NAME_TOO_LONG_REASON,
  ACTUAL_BUDGET_NOT_EXPENSE_REASON,
  ACTUAL_INCOME_BUDGET_REASON,
  getActualBudgetAmountReason,
  getActualBudgetGroupCategoryReason,
} from '@/pages/imports/actual/constants'
import { CREATE_CATEGORY_VALUE, IMPORT_BUDGET_NAME_MAX_LENGTH } from '@/pages/imports/constants'
import type { ActualBudgetFile } from '@/pages/imports/actual/types'
import type { ImportCategoryKind } from '@/pages/imports/types'
import { formatScaledAmount } from './amounts'
import { isGroupResource } from '@/pages/imports/utils/resourceScope'
import { getActualCategoryName } from './normalise'

// Actual budgets by calendar month, so every imported budget repeats on the first of each month
const ACTUAL_BUDGET_RECURRENCE: ImportBudgetRecurrence = {
  freq: 'monthly',
  instance_length: 1,
  weekday: null,
  dom: 1,
  month: null,
}

/**
 * One budget an Actual category becomes, with each month Actual budgeted above zero
 *
 * `amount` in each month is the integer Actual stored, in the file's budget scale
 */
export interface ActualBudgetDraft {
  /** Actual's category id, which also names the draft in the selection */
  categoryId: string
  name: string

  /**
   * The category's spending source, the one category the budget tracks, named by Actual's category id.
   * Payments to off-budget accounts count toward it only while they are filed as spending
   */
  categorySourceId: string
  months: { month: string; amount: number }[]

  /**
   * Whether the budget carries on past its imported months, which it does only when Actual
   * budgeted the category for the current month or later
   */
  recurs: boolean

  /** A category hidden in Actual, or in a hidden group, arrives as an archived budget */
  isArchived: boolean
  disabledReason: string | null
}

/**
 * Builds one budget for each category Actual budgeted above zero in any month
 *
 * A month budgeted at zero or below is no period at all, so the budget has a gap there, and money Actual
 * carried over between months is not a figure of its own. A budget whose last month has passed
 * keeps its months and stops, so a category the user stopped budgeting for doesn't come back
 *
 * @param currentMonth - This month in the user's own timezone, as YYYY-MM
 */
export function buildActualBudgetDrafts(budget: ActualBudgetFile, currentMonth: string): ActualBudgetDraft[] {
  const categoryById = new Map(budget.categories.map((category) => [category.id, category]))
  const monthsByCategory = new Map<string, { month: string; amount: number }[]>()
  for (const figure of budget.budgetFigures) {
    if (figure.amount <= 0 || !categoryById.has(figure.categoryId)) continue
    monthsByCategory.set(figure.categoryId, [...(monthsByCategory.get(figure.categoryId) ?? []), { month: figure.month, amount: figure.amount }])
  }

  const drafts: ActualBudgetDraft[] = []
  for (const [categoryId, months] of monthsByCategory) {
    const category = categoryById.get(categoryId)!
    months.sort((a, b) => a.month.localeCompare(b.month))
    const name = getActualCategoryName(category, budget.categories)
    drafts.push({
      categoryId,
      name,
      categorySourceId: categoryId,
      months,
      recurs: months[months.length - 1].month >= currentMonth,
      isArchived: category.hidden,
      disabledReason: category.isIncome
        ? ACTUAL_INCOME_BUDGET_REASON
        : name.length > IMPORT_BUDGET_NAME_MAX_LENGTH ? ACTUAL_BUDGET_NAME_TOO_LONG_REASON : null,
    })
  }
  return drafts.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Returns why a budget can't be imported with the answers given so far, or null
 *
 * @param currencyExponent - Decimal places the budget currency holds, null until one is settled
 */
export function getActualBudgetRefusal(
  draft: ActualBudgetDraft,
  {
    currency,
    budgetDecimals,
    currencyExponent,
    categoryMappings,
    categoryCreateKinds,
    categoryById,
  }: {
    currency: string | null
    budgetDecimals: number
    currencyExponent: number | null
    categoryMappings: Record<string, string>
    categoryCreateKinds: Record<string, ImportCategoryKind>
    categoryById: Map<string, Category>
  },
): string | null {
  if (draft.disabledReason) return draft.disabledReason

  // An imported budget is the user's own, so it can only track their own or built-in categories
  const choice = categoryMappings[draft.categorySourceId]
  const category = choice && choice !== CREATE_CATEGORY_VALUE ? categoryById.get(choice) : undefined
  if (category && isGroupResource(category)) return getActualBudgetGroupCategoryReason(category.name)
  const kind = choice === CREATE_CATEGORY_VALUE ? categoryCreateKinds[draft.categorySourceId] : category?.kind
  if (kind && kind !== 'expense') return ACTUAL_BUDGET_NOT_EXPENSE_REASON

  if (currency && currencyExponent !== null) {
    const month = draft.months.find(({ amount }) => formatScaledAmount(amount, budgetDecimals, currencyExponent) === null)
    if (month) return getActualBudgetAmountReason(formatScaledAmount(month.amount, budgetDecimals, budgetDecimals) ?? '', currency)
  }
  return null
}

/**
 * Builds the budgets request for the selected drafts, each month becoming one period from its first
 * day to its last
 *
 * @param budgetDecimals - Decimal places Actual stored the figures in
 * @param currencyExponent - Decimal places the budget currency holds in Lumina
 * @throws When a budget names a category source the import has no mapping for, which the commit
 *   would refuse, so it is caught before anything is uploaded
 */
export function buildActualRunBudgets(
  drafts: ActualBudgetDraft[],
  currency: string,
  budgetDecimals: number,
  currencyExponent: number,
  categoryMappings: TransactionImportCategoryMapping[],
): ImportRunBudgets {
  const mappingsBySource = new Map(categoryMappings.map((mapping) => [mapping.source, mapping]))
  const usedMappings = new Map<string, TransactionImportCategoryMapping>()

  const budgets = drafts.map((draft) => {
    const mapping = mappingsBySource.get(draft.categorySourceId)
    if (!mapping) throw new Error(`${draft.name}: its category is not mapped`)
    usedMappings.set(draft.categorySourceId, mapping)

    return {
      name: draft.name,
      currency,
      category_sources: [draft.categorySourceId],
      limits: draft.months.map(({ month, amount }) => {
        const text = formatScaledAmount(amount, budgetDecimals, currencyExponent)
        if (text === null) throw new Error(`${draft.name}: its amount for ${month} doesn't fit ${currency}`)
        return { start: `${month}-01`, end: getLastDayOfMonth(month), amount: text }
      }),
      recurrence: draft.recurs ? ACTUAL_BUDGET_RECURRENCE : null,
      is_archived: draft.isArchived,
    }
  })

  return { categories: [...usedMappings.values()], budgets }
}

function getLastDayOfMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return `${month}-${String(lastDay).padStart(2, '0')}`
}
