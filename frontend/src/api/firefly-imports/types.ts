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

/**
 * One batch of a staged export: the mappings its own rows reference, the rows, and where the
 * batch starts in the export
 */
export interface FireflyImportStageBatch extends FireflyTransactionImportPayload {
  start_row_index: number;
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
 *
 * Its tracked categories are named by category mapping source, since a category the same import
 * creates has no id until the commit
 */
export interface FireflyBudgetImportBudget {
  name: string;
  currency: string;
  category_sources: string[];
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

/**
 * Every budget a run creates, with the category mappings they name, since a budget can track a
 * category no staged row uses
 */
export interface FireflyImportRunBudgets {
  categories: TransactionImportCategoryMapping[];
  budgets: FireflyBudgetImportBudget[];
}

export interface FireflyBudgetImportResult {
  name: string;
  base_budget_id: string;
  instance_count: number;
}

/**
 * Everything a Firefly III import wrote in its one commit
 *
 * A row the server cannot write fails the whole commit, so nothing is ever skipped here. Transfers
 * between two mapped accounts produce two Lumina transactions from one journal row, so
 * transactions_created can exceed rows_imported
 */
export interface FireflyImportRunResponse extends TransactionImportResponse {
  rows_imported: number;
  budgets_created: number;
  budgets: FireflyBudgetImportResult[];
  accounts_archived: number;
  archive_adjustments_created: number;
}
