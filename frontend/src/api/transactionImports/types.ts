import type { Account } from '@/api/accounts';

export interface TransactionImportCreateAccount {
  name: string;
  account_type: Account['account_type'];
  currency: string;
  institution_id?: string | null;
}

export interface TransactionImportAccountMapping {
  source: string;
  account_id?: string | null;
  create?: TransactionImportCreateAccount | null;
}

export interface TransactionImportCreateCategory {
  name: string;
  kind: 'expense' | 'income' | 'transfer';
  icon?: string | null;
}

export interface TransactionImportCategoryMapping {
  source: string;
  category_id?: string | null;
  create?: TransactionImportCreateCategory | null;
}

export interface TransactionImportRow {
  account_source: string;
  category_source: string;
  dt: string;
  amount: string;
  merchant_name?: string | null;
  notes?: string | null;
  tag_names: string[];
}

export interface TransactionImportPayload {
  accounts: TransactionImportAccountMapping[];
  categories: TransactionImportCategoryMapping[];
  rows: TransactionImportRow[];
}

export interface TransactionImportResponse {
  transactions_created: number;
  accounts_created: number;
  accounts_reused: number;
  categories_created: number;
  categories_reused: number;
  merchants_created: number;
  merchants_reused: number;
  tags_created: number;
  tags_reused: number;
  affected_account_ids: string[];
  account_source_ids: Record<string, string>;
  category_source_ids: Record<string, string>;
  created_account_ids: string[];
  created_category_ids: string[];
  created_merchant_ids: string[];
  created_tag_ids: string[];
}
