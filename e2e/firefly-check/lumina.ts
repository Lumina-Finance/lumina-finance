/**
 * Reads back everything the comparison needs from Lumina's API, as the user who ran the import
 */
import type { APIRequestContext } from '@playwright/test'
import type { TestUser } from '../support/api'
import { API_BASE_URL } from '../support/target'
import type { LuminaSnapshot, LuminaTransaction } from './compare.ts'

// The most the transaction list returns at once
const PAGE_SIZE = 50

export async function readLumina(request: APIRequestContext, user: TestUser): Promise<LuminaSnapshot> {
  const read = async <T>(path: string): Promise<T> => {
    const response = await request.get(`${API_BASE_URL}${path}`, { headers: { Authorization: `Bearer ${user.accessToken}` } })
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

  return {
    accounts: await read('/accounts'),
    transactions,
    categories: await read('/categories'),
    baseBudgets: await read('/base-budgets'),
    budgetPeriods: await read('/budgets'),
  }
}
