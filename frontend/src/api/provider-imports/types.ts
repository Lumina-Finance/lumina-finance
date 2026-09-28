import type { RecurrenceFreq } from '@/api/budgets/types';
import type {
  TransactionImportAccountMapping,
  TransactionImportCategoryMapping,
  TransactionImportResponse,
} from '@/api/transaction-imports/types';

/** The apps whose exports are staged as journal rows */
export type JournalImportSource = 'firefly' | 'actual_budget';

/**
 * Which leg of a transfer between two imported accounts carries the row's category, the other
 * keeping Transfer. Set when the transfer is spending the user budgets for, such as a loan payment
 * from a budgeted account, since both legs carrying one category would cancel in its budget. Both
 * files both legs under a transfer category, as a credit card payment is
 */
export type JournalCategoryLeg = 'source' | 'destination' | 'both';

/**
 * One export journal row compiled by the frontend
 *
 * Every value is in the one form the endpoint takes, which refuses any other: a lowercased type,
 * amounts as magnitudes in plain decimal text so the backend can validate precision against the
 * account currency, upper-case currency codes, and trimmed text with a missing value sent as null
 *
 * An endpoint the import writes to is named by its account mapping source and carries no name,
 * since an export can give two accounts one name. Any other endpoint is named as the export
 * writes it
 */
export interface JournalImportRow {
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

  /** Only on a transfer, and only with a category. Absent keeps both legs on Transfer */
  category_leg?: JournalCategoryLeg | null;
  tag_names: string[];
  notes: string | null;
}

export interface JournalImportPayload {
  accounts: TransactionImportAccountMapping[];
  categories: TransactionImportCategoryMapping[];
  rows: JournalImportRow[];
}

/**
 * One batch of a staged export: the mappings its own rows reference, the rows, and where the
 * batch starts in the export. The first batch also carries any account the import creates empty
 */
export interface JournalImportStageBatch extends JournalImportPayload {
  start_row_index: number;
}

/**
 * One budget limit period with its inclusive dates
 *
 * Each period becomes a budget period with these exact dates. The amount
 * is a magnitude in plain decimal text so the backend can validate
 * precision against the budget currency
 */
export interface ImportBudgetLimit {
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
export interface ImportBudgetRecurrence {
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
export interface ImportBudgetDraft {
  name: string;
  currency: string;
  category_sources: string[];
  limits: ImportBudgetLimit[];

  /**
   * Null when the latest limit period fits no cadence, which imports the budget not recurring
   */
  recurrence: ImportBudgetRecurrence | null;

  /**
   * An archived budget arrives with its history frozen and stays out of the active budget list
   */
  is_archived: boolean;
}

/**
 * Every budget a run creates, with the category mappings they name, since a budget can track a
 * category no staged row uses
 */
export interface ImportRunBudgets {
  categories: TransactionImportCategoryMapping[];
  budgets: ImportBudgetDraft[];
}

export interface ImportBudgetResult {
  name: string;
  base_budget_id: string;
  instance_count: number;
}

/**
 * Everything a provider import wrote in its one commit
 *
 * A row the server cannot write fails the whole commit, so nothing is ever skipped here. Transfers
 * between two mapped accounts produce two Lumina transactions from one journal row, so
 * transactions_created can exceed rows_imported
 */
export interface JournalImportRunResponse extends TransactionImportResponse {
  rows_imported: number;
  budgets_created: number;
  budgets: ImportBudgetResult[];
  accounts_archived: number;
  archive_adjustments_created: number;
}
