import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Transaction } from '@/api/transactions'
import type { TransactionImportPayload } from '@/api/transaction-imports'

export type ColumnTarget =
  | 'account_id'
  | 'dt'
  | 'category_id'
  | 'amount'
  | 'amount_out'
  | 'amount_in'
  | 'amount_direction'
  | 'currency'
  | 'merchant_id'
  | 'notes'
  | 'tag_ids'
  | 'counterparty_account_id'

/**
 * How a column target is required, which is also what heads it in the mapping dropdown
 *
 * The amount group is its own answer because the three fields in it share one requirement between
 * them: an import needs at least one of them mapped. The two sides go together, or either one alone
 * where the file holds money going only one way, and the single signed column never sits beside a
 * side, since a file states its amounts one way or the other
 *
 * The direction group holds one field and is required by nothing, but it heads itself rather than
 * sitting among the optional fields, because it only means anything beside the single Amount column
 * and the heading is where that belongs
 */
export type ColumnTargetGroup = 'required' | 'amount' | 'direction' | 'optional'

/**
 * Whether money is leaving the account or arriving in it
 */
export type ImportAmountDirection = 'out' | 'in'

/**
 * Why a row cannot be read from the columns carrying its amount
 *
 * A fact about the row's cells rather than a message, since reading a row and judging it are kept
 * apart and only the judgement puts words to it
 *
 * The first five are the file writing money out and money in in separate columns. The last two
 * are the file carrying its direction in a column of words, read alongside a single Amount column.
 * A file uses one arrangement or the other, so only one of these can ever be reached
 */
export type ImportAmountProblem =
  | 'bothFilled'
  | 'neitherFilled'
  | 'sideStatesZero'
  | 'outSideStatesPlus'
  | 'inSideStatesMinus'
  | 'directionBlank'
  | 'directionSignDisagrees'

/** The two fields a file uses when it keeps its money going out and its money coming in apart */
export type ImportAmountSideTarget = 'amount_out' | 'amount_in'

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
 * One row the import has something to say about, against its position among the file's data rows
 *
 * Used for both kinds: a row that cannot be converted, and one that will be taken but is probably
 * not what the user meant. What it means is decided by the list it is in rather than by the shape
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
