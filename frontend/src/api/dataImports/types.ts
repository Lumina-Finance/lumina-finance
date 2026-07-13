import type {
  TransactionImportAccountMapping,
  TransactionImportCategoryMapping,
  TransactionImportResponse,
} from '@/api/transactionImports/types';

/**
 * One Firefly III export journal row compiled by the frontend
 *
 * Amounts stay raw CSV strings so the backend can validate precision against
 * the account currency, and sign conventions are ignored server side
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
  source_name: string | null;
  source_type: string | null;
  destination_name: string | null;
  destination_type: string | null;
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
 * Transfers between two mapped accounts produce two Lumina transactions from
 * one journal row, so transactions_created can exceed rows_imported
 */
export interface FireflyTransactionImportResponse extends TransactionImportResponse {
  rows_imported: number;
  rows_skipped: number;
  skipped: FireflySkippedRow[];
}
