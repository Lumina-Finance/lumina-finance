import type { CsvRow, ImportFileDraft } from '../../types'
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
 * Derives importable monthly budget drafts from the budgets export, transaction
 * usage, and the category IDs resolved by the committed transaction import
 */
export function buildFireflyBudgetDrafts({
  budgetsFile,
  transactionRows,
  categorySourceIds,
}: {
  budgetsFile: ImportFileDraft | null
  transactionRows: CsvRow[]
  categorySourceIds: Record<string, string>
}): FireflyBudgetDraft[] {
  if (!budgetsFile || budgetsFile.error) return []

  // The budgets export repeats one row per limit period, so the most recent
  // start date decides the monthly amount carried into Lumina
  const latestLimitByName = new Map<string, { startDate: string; amount: string; currencyCode: string }>()
  for (const row of budgetsFile.rows) {
    const name = row.name?.trim()
    const startDate = row.start_date?.trim() ?? ''
    if (!name) continue

    const current = latestLimitByName.get(name)
    if (!current || startDate > current.startDate) {
      latestLimitByName.set(name, {
        startDate,
        amount: row.amount?.trim() ?? '',
        currencyCode: row.currency_code?.trim().toUpperCase() ?? '',
      })
    }
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
  for (const [name, limit] of latestLimitByName) {
    drafts.push(buildBudgetDraft(name, limit, usageByName.get(name), categorySourceIds))
  }

  return drafts.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Resolves one budget name into a draft, disabling it when the export cannot
 * back a Lumina budget
 */
function buildBudgetDraft(
  name: string,
  limit: { amount: string; currencyCode: string },
  usage: FireflyBudgetUsage | undefined,
  categorySourceIds: Record<string, string>,
): FireflyBudgetDraft {
  const categoryNames: string[] = []
  const categoryIds: string[] = []
  const seenIds = new Set<string>()

  for (const categoryName of usage?.categoryNames ?? []) {
    const categoryId = categorySourceIds[categoryName]
    if (!categoryId || seenIds.has(categoryId)) continue
    seenIds.add(categoryId)
    categoryNames.push(categoryName)
    categoryIds.push(categoryId)
  }
  categoryNames.sort((a, b) => a.localeCompare(b))

  const periodStart = usage?.earliestDate ? `${usage.earliestDate.slice(0, 7)}-01` : null
  const disabledReason = !usage || !periodStart
    ? 'No imported transactions reference this budget'
    : categoryIds.length === 0
      ? 'No mapped categories reference this budget'
      : !limit.amount || !limit.currencyCode
        ? 'The export has no limit amount for this budget'
        : null

  return {
    name,
    amount: limit.amount,
    currencyCode: limit.currencyCode,
    periodStart,
    categoryNames,
    categoryIds,
    disabledReason,
  }
}
