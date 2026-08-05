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
  | 'counterparty_account_id'

export type ColumnMap = Record<ColumnTarget, string>
export type ColumnValidationErrors = Record<string, string>
export type CsvRow = Record<string, string>
export type ImportCategoryKind = Category['kind']
export type ImportDataSource = 'generic' | 'firefly'
export type ImportOverlayPhase = 'idle' | 'importing' | 'success' | 'error' | 'cancelled'
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

  /** True when no row is written to this source, which is the only case that can answer "outside" */
  isCounterpartyOnly: boolean
}

export interface ImportFileDraft {
  id: string
  name: string
  size: number
  headers: string[]
  hasHeaderRow: boolean
  rows: CsvRow[]
  error: string | null

  /**
   * Something worth saying about a file that still staged, such as characters the decoder could not
   * read, told apart from `error` because the file is usable and the import can go ahead
   *
   * Optional rather than nullable, since only the reader sets it and every other way a draft is
   * built has nothing to say
   */
  notice?: string
}

export interface PreviewTransactionRow {
  id: string
  accountInstitution: AccountsOverview['institution']
  accountName: string
  category: Category | undefined
  currency: string
  dateLabel: string
  transaction: Transaction

  /** Name behind the transaction's counterparty account, since the preview has no account list to read */
  counterpartyAccountName?: string
}

/**
 * One row the import cannot convert, against its position among the file's data rows
 *
 * The cells are the row as it was read, so the table can show it under the file's own headers
 */
export interface ImportRowProblem {
  /** Identity of the row within the staged file, which the preview reads to leave it out */
  id: string
  rowNumber: number
  cells: CsvRow
  reason: string
}

export interface ImportBuildResult {
  errors: string[]
  rowProblems: ImportRowProblem[]

  /**
   * Things worth saying about the import that do not stop it
   *
   * Kept apart from `errors`, which the commit button waits on. A warning describes data that is
   * probably wrong but might be exactly what the user meant, so refusing it would be worse
   */
  warnings: string[]

  /**
   * Rows the import will take but that are probably not what the user meant, listed the same way a
   * refused row is. The commit does not wait on these
   */
  rowWarnings: ImportRowProblem[]

  /**
   * Rows left out because the user chose to leave them out, rather than because anything is wrong
   * with them. Listed so the choice is visible, and the commit does not wait on these either: an
   * import that leaves them behind is a valid import of the rows that remain
   */
  rowExclusions: ImportRowProblem[]
  payload: TransactionImportPayload | null
}

/**
 * Why no file can be staged yet, shown over the upload control
 *
 * A block the user has to act on is told apart from one that clears itself, so waiting on an
 * ordinary page load is not dressed as an error
 */
export interface ImportUploadBlock {
  message: string
  isFailure: boolean
}
