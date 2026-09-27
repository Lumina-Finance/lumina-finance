/**
 * Reads which of Lumina's records stand for which Actual account, category and budget, from the
 * requests of the import run and what the server answered them
 */
import { TRANSFER_CATEGORY_SOURCE_PREFIX, type ImportMappings } from './compare.ts'

/** One request of the import run and what the server answered */
export interface CapturedUpload {
  method: string
  path: string
  body: unknown
  response: unknown
}

interface CommitResponse {
  account_source_ids: Record<string, string>
  category_source_ids: Record<string, string>
  budgets: { name: string; base_budget_id: string }[]
}

interface BudgetsBody {
  budgets: { name: string; category_sources: string[] }[]
}

/**
 * Pairs Lumina's records with Actual's: the commit names the Lumina account and category each
 * uploaded source became, and the budgets request names the Actual category of each budget, whose
 * Lumina id the commit gives by name
 */
export function readImportMappings(uploads: CapturedUpload[]): ImportMappings {
  const commits = uploads.filter((upload) => upload.method === 'POST' && upload.path.endsWith('/journal/commit') && upload.response)
  if (commits.length !== 1) throw new Error(`The import run answered ${commits.length} commits`)
  const commit = commits[0].response as CommitResponse

  const budgetUploads = uploads.filter((upload) => upload.method === 'PUT' && upload.path.endsWith('/budgets'))
  if (budgetUploads.length > 1) throw new Error(`The screen sent the budgets ${budgetUploads.length} times`)
  const budgetIdByName = new Map(commit.budgets.map((budget) => [budget.name, budget.base_budget_id]))
  const budgets = new Map<string, string>()
  for (const budget of (budgetUploads[0]?.body as BudgetsBody | undefined)?.budgets ?? []) {
    const categoryIds = new Set(budget.category_sources.map((source) => (
      source.startsWith(TRANSFER_CATEGORY_SOURCE_PREFIX) ? source.slice(TRANSFER_CATEGORY_SOURCE_PREFIX.length) : source
    )))
    if (categoryIds.size !== 1) throw new Error(`The budget ${budget.name} tracks ${categoryIds.size} Actual categories`)
    const baseBudgetId = budgetIdByName.get(budget.name)
    if (baseBudgetId) budgets.set([...categoryIds][0], baseBudgetId)
  }

  return {
    accounts: new Map(Object.entries(commit.account_source_ids)),
    categories: new Map(Object.entries(commit.category_source_ids)),
    budgets,
  }
}
