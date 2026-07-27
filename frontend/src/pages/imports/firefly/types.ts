import type { AccountType } from '@/api/accounts'
import type { FireflyBudgetImportLimit, FireflyTransactionImportPayload } from '@/api/firefly-imports'

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

  /**
   * Currency of the latest limit period, which is the budget currency when
   * the history holds exactly one
   */
  currencyCode: string

  /**
   * Distinct currencies across the limit history, more than one of which
   * makes the budget unimportable
   */
  currencyCodes: string[]
  isArchived: boolean

  /**
   * Full limit period schedule sorted by start date, sent to the backend so
   * every period keeps its exported dates and amount
   */
  limits: FireflyBudgetImportLimit[]
  firstPeriodStart: string | null
  lastPeriodEnd: string | null

  /**
   * How the latest limit period repeats, in words the drafts table can show
   */
  periodLabel: string | null

  /**
   * Export category names the budget's transactions carry, resolved to
   * category IDs only once the transactions commit reports them
   */
  categoryNames: string[]
  disabledReason: string | null
}

export type FireflyBudgetImportStatus = 'imported' | 'error'

/**
 * Stage of the two-phase commit currently holding the overlay
 */
export type FireflyImportStage = 'transactions' | 'budgets'

/**
 * Stage holding the overlay and whether its work has landed
 *
 * The finished stage keeps the overlay for a beat so it can be struck off
 * before the next stage starts, which the two fields have to express together
 */
export interface FireflyImportStageState {
  stage: FireflyImportStage
  isFinished: boolean
}
