import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Transaction } from '@/api/transactions'
import type { TransactionImportPayload } from '@/api/transaction-imports'

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
export type ImportDataSource = 'generic' | 'firefly'
export type ImportOverlayPhase = 'idle' | 'importing' | 'success' | 'error'
export type ImportProgressStepStatus = 'active' | 'queued' | 'done'

/**
 * One stage of a multi-stage import, listed under the overlay spinner
 *
 * A done step is struck off in place and leaves the stack once the flow drops
 * it from the list, so the stage in progress is always the top line
 */
export interface ImportProgressStep {
  id: string
  label: string
  status: ImportProgressStepStatus
}

export interface ImportAccountSource {
  id: string
  label: string
  matchText: string
}

export interface ImportFileDraft {
  id: string
  name: string
  size: number
  headers: string[]
  hasHeaderRow: boolean
  rows: CsvRow[]
  error: string | null
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
