import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Transaction, TransactionImportPayload } from '@/api/transactions'

export type ImportMode = 'single-file' | 'file-per-account'
export type ColumnTarget =
  | 'account_id'
  | 'dt'
  | 'category_id'
  | 'amount'
  | 'currency'
  | 'merchant_id'
  | 'notes'
  | 'tag_ids'

export type ColumnMap = Record<ColumnTarget, string>
export type ColumnValidationErrors = Record<string, string>
export type CsvRow = Record<string, string>
export type ImportCategoryKind = Category['kind']

export interface ImportFileDraft {
  id: string
  name: string
  size: number
  headers: string[]
  rows: CsvRow[]
  error: string | null
  accountId: string
}

export interface PreviewTransactionRow {
  id: string
  accountInstitution: AccountsOverview['institution']
  accountName: string
  category: Category | undefined
  currency: string
  dateLabel: string
  transaction: Transaction
}

export interface ImportBuildResult {
  errors: string[]
  payload: TransactionImportPayload | null
}
