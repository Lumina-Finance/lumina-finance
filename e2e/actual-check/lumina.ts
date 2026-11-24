/**
 * Reads which of Lumina's records stand for which Actual account, category and budget, from the
 * requests of the import run and what the server answered them
 */
import { readBudgetsUpload, type CapturedUpload } from '../support/import-check/uploads.ts'
import type { ImportMappings } from './compare.ts'

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
 * tracks. That source is its Actual category's id, and the commit gives its Lumina id by name.
 * The summary comes with the answer that finds the save done, and a later request for it may be that
 */
export function readImportMappings(uploads: CapturedUpload[]): ImportMappings {
  const commits = uploads.filter((upload) => upload.path.endsWith('/journal/commit')
    && typeof upload.response === 'object' && upload.response !== null && 'account_source_ids' in upload.response)
  if (commits.length !== 1) throw new Error(`The import run answered ${commits.length} commits`)
  const commit = commits[0].response as CommitResponse

  const budgetIdByName = new Map(commit.budgets.map((budget) => [budget.name, budget.base_budget_id]))
  const budgets = new Map<string, string>()
  for (const budget of readBudgetsUpload<{ source: string }, BudgetsBody['budgets'][number]>(uploads)?.budgets ?? []) {
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
