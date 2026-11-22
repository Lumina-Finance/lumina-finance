/**
 * Reads back everything the import checks compare from Lumina's API, as the user who imported
 */
import type { APIRequestContext } from '@playwright/test'
import { asUser, type TestUser } from '../api'
import { API_BASE_URL } from '../target'
import type { LuminaBaseBudget, LuminaBudgetPeriod, LuminaSnapshot, LuminaTransaction } from './compare.ts'

// The most the transaction list returns at once
const PAGE_SIZE = 50

export async function readLumina(request: APIRequestContext, user: TestUser): Promise<LuminaSnapshot> {
  const read = async <T>(path: string): Promise<T> => {
    const response = await request.get(`${API_BASE_URL}${path}`, { headers: asUser(user) })
    if (!response.ok()) throw new Error(`GET ${path} answered ${response.status()}: ${await response.text()}`)
    return await response.json() as T
  }

  // Ordered by date with the id breaking ties, so offsets page through a list that stays put
  const transactions: LuminaTransaction[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await read<(Omit<LuminaTransaction, 'original_amount'> & { account_amount: number | null })[]>(
      `/transactions?sort_by=dt&sort_order=asc&limit=${PAGE_SIZE}&offset=${offset}`,
    )
    // A row in another currency than its account's is counted in the account's, as the balance is
    transactions.push(...page.map(({ account_amount, ...transaction }) => ({
      ...transaction,
      amount: account_amount ?? transaction.amount,
      original_amount: transaction.amount,
    })))
    if (page.length < PAGE_SIZE) break
  }

  // The budget list carries only each budget's latest period, so the history of each is read from its utilizations
  const baseBudgets = await read<LuminaBaseBudget[]>('/base-budgets')
  const budgetPeriods: LuminaBudgetPeriod[] = []
  for (const baseBudget of baseBudgets) {
    const history = await read<Omit<LuminaBudgetPeriod, 'base_budget_id'>[]>(`/base-budgets/${baseBudget.id}/utilizations`)
    budgetPeriods.push(...history.map(({ period_start, period_end, overall_limit }) => ({
      base_budget_id: baseBudget.id,
      period_start,
      period_end,
      overall_limit,
    })))
  }

  return {
    accounts: await read('/accounts'),
    transactions,
    categories: await read('/categories'),
    baseBudgets,
    budgetPeriods,
  }
}
