/**
 * Reads which of Lumina's records stand for which Actual account, category and budget, from the
 * requests of the import run and what the server answered them
 */
import type { ImportMappings } from './compare.ts'

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
 * uploaded source became, and the budgets request names the one category source each budget
 * tracks, which is its Actual category's id, and whose Lumina id the commit gives by name
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
    if (budget.category_sources.length !== 1) throw new Error(`The budget ${budget.name} tracks ${budget.category_sources.length} category sources`)
    const baseBudgetId = budgetIdByName.get(budget.name)
    if (baseBudgetId) budgets.set(budget.category_sources[0], baseBudgetId)
  }

  return {
    accounts: new Map(Object.entries(commit.account_source_ids)),
    categories: new Map(Object.entries(commit.category_source_ids)),
    budgets,
  }
}
