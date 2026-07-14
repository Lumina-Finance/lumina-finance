import type { AccountType } from '@/api/accounts'
import type { FireflyTransactionImportPayload } from '@/api/dataImports'

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
  invalidRowCount: number
  transactionEstimate: number
  skipRiskCount: number
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
  amount: string
  currencyCode: string

  /**
   * First day of the month of the earliest transaction carrying the budget
   */
  periodStart: string | null
  categoryNames: string[]
  categoryIds: string[]
  disabledReason: string | null
}

export type FireflyBudgetImportStatus = 'imported' | 'error'
