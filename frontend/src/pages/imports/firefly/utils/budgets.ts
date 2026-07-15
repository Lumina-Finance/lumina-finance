import type { FireflyBudgetImportBudget, FireflyBudgetImportLimit } from '@/api/dataImports'
import type { CsvRow, ImportFileDraft } from '../../types'
import { FIREFLY_BUDGET_ACTIVE_VALUE, FIREFLY_BUDGET_ARCHIVED_REASON } from '../constants'
import type { FireflyBudgetDraft } from '../types'
import { getFireflyRowDate } from './derivation'

/**
 * How transactions in the export reference one budget name
 */
interface FireflyBudgetUsage {
  earliestDate: string
  categoryNames: Set<string>
}

/**
 * One budgets-export row reduced to the fields a limit schedule needs
 */
interface FireflyLimitRow {
  start: string
  amount: string
  currencyCode: string
}

/**
 * One budget name's rows from the export, with the archived flag read off them
 *
 * Firefly III repeats the flag on every limit period of a budget because the
 * export is one row per period, so it is read once per name
 */
interface FireflyBudgetRows {
  isArchived: boolean
  limitRows: FireflyLimitRow[]
}

/**
 * Derives importable monthly budget drafts from the budgets export and the
 * staged transaction rows
 *
 * Drafts derive before the commit so the budget preview can drive what the
 * commit imports, which leaves category IDs to be resolved from the commit
 * response afterwards
 */
export function buildFireflyBudgetDrafts({
  budgetsFile,
  transactionRows,
}: {
  budgetsFile: ImportFileDraft | null
  transactionRows: CsvRow[]
}): FireflyBudgetDraft[] {
  if (!budgetsFile || budgetsFile.error) return []

  // The budgets export repeats one row per limit period, so every row of a
  // name contributes to that budget's limit schedule
  const rowsByName = new Map<string, FireflyBudgetRows>()
  for (const row of budgetsFile.rows) {
    const name = row.name?.trim()
    if (!name) continue

    const budget = rowsByName.get(name)
      ?? { isArchived: row.active?.trim() !== FIREFLY_BUDGET_ACTIVE_VALUE, limitRows: [] }
    budget.limitRows.push({
      start: row.start_date?.trim() ?? '',
      amount: row.amount?.trim() ?? '',
      currencyCode: row.currency_code?.trim().toUpperCase() ?? '',
    })
    rowsByName.set(name, budget)
  }

  const usageByName = new Map<string, FireflyBudgetUsage>()
  for (const row of transactionRows) {
    const budgetName = row.budget?.trim()
    if (!budgetName) continue

    const rowDate = getFireflyRowDate(row.date ?? '')
    const usage = usageByName.get(budgetName) ?? { earliestDate: '', categoryNames: new Set<string>() }
    if (rowDate && (!usage.earliestDate || rowDate < usage.earliestDate)) usage.earliestDate = rowDate

    const category = row.category?.trim()
    if (category) usage.categoryNames.add(category)
    usageByName.set(budgetName, usage)
  }

  const drafts: FireflyBudgetDraft[] = []
  for (const [name, budget] of rowsByName) {
    drafts.push(buildBudgetDraft(name, budget, usageByName.get(name)))
  }

  return drafts.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Turns budget drafts into the commit payload by resolving each draft's export
 * category names through the category IDs the transactions commit reported
 *
 * Every distinct row category is an import source, so the response carries all
 * of them, and a name that is somehow absent is dropped rather than failing the
 * budget it belongs to
 */
export function buildFireflyBudgetImportBudgets(
  drafts: FireflyBudgetDraft[],
  categorySourceIds: Record<string, string>,
): FireflyBudgetImportBudget[] {
  return drafts.map((draft) => {
    const categoryIds: string[] = []
    const seenIds = new Set<string>()

    for (const categoryName of draft.categoryNames) {
      const categoryId = categorySourceIds[categoryName]
      if (!categoryId || seenIds.has(categoryId)) continue
      seenIds.add(categoryId)
      categoryIds.push(categoryId)
    }

    // Importable drafts always carry a backdate start because drafts without
    // one are disabled and never reach the commit
    return {
      name: draft.name,
      currency: draft.currencyCode,
      category_ids: categoryIds,
      period_start: draft.periodStart!,
      limits: draft.limits,
    }
  })
}

/**
 * Builds the sorted limit schedule for one budget from its export rows
 *
 * Rows without a start date or amount cannot place a limit in the schedule and
 * are dropped, and exact duplicate rows collapse to one entry while conflicting
 * amounts on the same start pass through for the backend to reject
 */
function buildLimitSchedule(limitRows: FireflyLimitRow[]): FireflyBudgetImportLimit[] {
  const seen = new Set<string>()
  const limits: FireflyBudgetImportLimit[] = []

  for (const row of limitRows) {
    if (!row.start || !row.amount) continue

    const key = `${row.start} ${row.amount}`
    if (seen.has(key)) continue
    seen.add(key)
    limits.push({ start: row.start, amount: row.amount })
  }

  return limits.sort((a, b) => a.start.localeCompare(b.start))
}

/**
 * Resolves one budget name into a draft, disabling it when the export cannot
 * back a Lumina budget
 */
function buildBudgetDraft(
  name: string,
  budget: FireflyBudgetRows,
  usage: FireflyBudgetUsage | undefined,
): FireflyBudgetDraft {
  const categoryNames = [...usage?.categoryNames ?? []].sort((a, b) => a.localeCompare(b))
  const limits = buildLimitSchedule(budget.limitRows)

  // The most recent start date decides the amount and currency the drafts
  // table displays, while the full schedule travels to the backend
  let latest: FireflyLimitRow | null = null
  for (const row of budget.limitRows) {
    if (!row.start || !row.amount) continue
    if (!latest || row.start > latest.start) latest = row
  }

  // Being archived is checked before the rest because it settles the budget on
  // its own, whatever its transactions and limits look like
  const periodStart = usage?.earliestDate ? `${usage.earliestDate.slice(0, 7)}-01` : null
  const disabledReason = budget.isArchived
    ? FIREFLY_BUDGET_ARCHIVED_REASON
    : !usage || !periodStart
      ? 'No imported transactions reference this budget'
      : categoryNames.length === 0
        ? 'No mapped categories reference this budget'
        : !latest || !latest.currencyCode
          ? 'The export has no limit amount for this budget'
          : null

  return {
    name,
    amount: latest?.amount ?? '',
    currencyCode: latest?.currencyCode ?? '',
    limits,
    periodStart,
    categoryNames,
    disabledReason,
  }
}
