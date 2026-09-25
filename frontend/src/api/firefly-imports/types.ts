import type { RecurrenceFreq } from '@/api/budgets/types';
import type {
  TransactionImportAccountMapping,
  TransactionImportCategoryMapping,
  TransactionImportResponse,
} from '@/api/transaction-imports/types';

/**
 * One Firefly III export journal row compiled by the frontend
 *
 * Amounts are trimmed decimal text without grouping separators so the backend can
 * validate precision against the account currency. Sign conventions are ignored server side
 *
 * An endpoint the import writes to is named by its account mapping source and carries no name,
 * since Firefly III lets an asset account and a liability share one. Any other endpoint is named
 * as the export writes it
 */
export interface FireflyTransactionImportRow {
  journal_id: string;
  type: string;

  /**
   * ISO date in YYYY-MM-DD form
   */
  dt: string;
  amount: string;
  currency_code: string;
  foreign_amount: string | null;
  foreign_currency_code: string | null;
  description: string | null;
  source_account: string | null;
  source_name: string | null;
  destination_account: string | null;
  destination_name: string | null;
  category: string | null;
  tag_names: string[];
  notes: string | null;
}

export interface FireflyTransactionImportPayload {
  accounts: TransactionImportAccountMapping[];
  categories: TransactionImportCategoryMapping[];
  rows: FireflyTransactionImportRow[];
}

export interface FireflySkippedRow {
  journal_id: string;
  reason: string;
}

/**
 * One budget limit period with its inclusive dates
 *
 * Each period becomes a budget period with these exact dates. The amount
 * is trimmed decimal text without grouping separators so the backend can validate
 * precision against the budget currency
 */
export interface FireflyBudgetImportLimit {
  /**
   * ISO dates in YYYY-MM-DD form
   */
  start: string;
  end: string;
  amount: string;
}

/**
 * The cadence a budget continues on, read off its latest limit period in the browser
 *
 * The anchor fields follow the budget create rules: a weekday for weekly, a day of month for
 * monthly, and a day of month with a month for yearly, the others null
 */
export interface FireflyBudgetImportRecurrence {
  freq: RecurrenceFreq;
  instance_length: number;
  weekday: number | null;
  dom: number | null;
  month: number | null;
}

/**
 * One budget with its full limit period schedule, sorted by start date
 */
export interface FireflyBudgetImportBudget {
  name: string;
  currency: string;
  category_ids: string[];
  limits: FireflyBudgetImportLimit[];

  /**
   * Null when the latest limit period fits no cadence, which imports the budget not recurring
   */
  recurrence: FireflyBudgetImportRecurrence | null;

  /**
   * An archived budget arrives with its history frozen and stays out of the active budget list
   */
  is_archived: boolean;
}

export interface FireflyBudgetImportPayload {
  budgets: FireflyBudgetImportBudget[];
}

export interface FireflyBudgetImportResult {
  name: string;
  base_budget_id: string;
  instance_count: number;
}

/**
 * The backend creates all budgets atomically, so a failure means none were
 * imported and the error detail names the budget it rejected
 */
export interface FireflyBudgetImportResponse {
  budgets_created: number;
  results: FireflyBudgetImportResult[];
}

/**
 * Transfers between two mapped accounts produce two Lumina transactions from
 * one journal row, so transactions_created can exceed rows_imported
 */
export interface FireflyTransactionImportResponse extends TransactionImportResponse {
  rows_imported: number;
  rows_skipped: number;
  skipped: FireflySkippedRow[];
}
