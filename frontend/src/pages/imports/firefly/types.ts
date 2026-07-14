import type { AccountType } from '@/api/accounts'
import type { FireflyBudgetImportLimit, FireflyTransactionImportPayload } from '@/api/dataImports'

export type FireflyFileKind = 'transactions' | 'budgets'

/**
 * Create-new defaults for one tracked Firefly III account name
 */
export interface FireflyAccountPrefill {
  accountType: AccountType
  currency: string
}

/**
 * Row and transaction counts derived in one pass over the transactions export
 */
export interface FireflyImportEstimate {
  rowCount: number
  transactionEstimate: number
}

export interface FireflyImportBuildResult {
  errors: string[]
  payload: FireflyTransactionImportPayload | null
}

/**
 * One budget derived from the budgets export, disabled when it cannot be imported
 */
export interface FireflyBudgetDraft {
  name: string

  /**
   * Latest limit amount, shown in the drafts table
   */
  amount: string
  currencyCode: string

  /**
   * Full limit schedule sorted by start date, sent to the backend so every
   * backfilled period keeps the amount in force at the time
   */
  limits: FireflyBudgetImportLimit[]

  /**
   * First day of the month of the earliest transaction carrying the budget
   */
  periodStart: string | null
  categoryNames: string[]
  categoryIds: string[]
  disabledReason: string | null
}

export type FireflyBudgetImportStatus = 'imported' | 'error'
