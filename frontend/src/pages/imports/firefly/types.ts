import type { AccountType } from '@/api/accounts'
import type {
  FireflyBudgetImportLimit,
  FireflyBudgetImportRecurrence,
  FireflyTransactionImportPayload,
} from '@/api/firefly-imports'

export type FireflyFileKind = 'transactions' | 'budgets' | 'accounts'

/**
 * What the accounts export says about one asset account or liability
 */
export interface FireflyAccountDetails {
  name: string

  /** Firefly III account type as the export writes it */
  type: string

  /** Asset account role, empty for a liability */
  role: string

  /** Upper-case currency code, empty when the export states none */
  currencyCode: string
  isActive: boolean
}

/**
 * One account the import writes to or creates, which the user maps to a Lumina account
 */
export interface FireflyAccountSource {
  /** Mapping source the mappings and the commit name this account by */
  id: string
  name: string

  /** Firefly III account type as the export writes it */
  type: string

  /** Name the mapping step shows, with the type added when another account shares the name */
  label: string

  /** What the accounts export says about the account, null without that file or when it's not listed */
  details: FireflyAccountDetails | null
}

/**
 * Every account the import writes to or creates, with the lookup rows resolve their endpoints by
 */
export interface FireflyAccountSources {
  list: FireflyAccountSource[]

  /** Finds the account one row endpoint names, or null when the endpoint is not one the import writes to */
  find: (name: string | undefined, type: string | undefined) => FireflyAccountSource | null
}

/**
 * Create-new defaults for one tracked Firefly III account
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

  /**
   * Account and category sources the import sends, kept even when errors block the payload: the
   * ones the uploaded rows use, and the accounts from the accounts export it creates. Any other
   * source only skipped rows use is left out, so the commit creates nothing for it
   */
  writtenSources: { accounts: ReadonlySet<string>; categories: ReadonlySet<string> }

  /** Accounts the import creates that the accounts export marks inactive, archived once written */
  archiveAccountSources: string[]
}

/**
 * One budget derived from the budgets export, disabled when it cannot be imported
 */
export interface FireflyBudgetDraft {
  name: string

  /**
   * Latest limit amount formatted for its currency, shown in the drafts table, or the exported
   * text beside its code when the currency cannot read it
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
   * Cadence the budget continues on, null when its latest limit period fits none
   */
  recurrence: FireflyBudgetImportRecurrence | null

  /**
   * How the budget repeats, in words the drafts table can show
   */
  periodLabel: string | null

  /**
   * Export category names the budget's transactions carry, sent as the category mapping sources
   * the commit resolves
   */
  categoryNames: string[]
  disabledReason: string | null
}

/**
 * Stage of the import currently holding the overlay: uploading the export, which saves nothing,
 * then writing all of it at once
 */
export type FireflyImportStage = 'uploading' | 'saving'

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
