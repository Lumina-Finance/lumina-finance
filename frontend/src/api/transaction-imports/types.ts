import type { AccountType } from '@/api/accounts/types'

export interface TransactionImportCreateAccount {
  name: string
  account_type: AccountType
  currency: string
  institution_id?: string | null
}

export interface TransactionImportAccountMapping {
  source: string
  account_id?: string | null
  create?: TransactionImportCreateAccount | null

  /** True for a source that is money outside the tracked accounts, which no row may be written to */
  outside?: boolean
}

export interface TransactionImportCreateCategory {
  name: string
  kind: 'expense' | 'income' | 'transfer'
  icon?: string | null
}

export interface TransactionImportCategoryMapping {
  source: string
  category_id?: string | null
  create?: TransactionImportCreateCategory | null
}

export interface TransactionImportCreateMerchant {
  name: string
}

/**
 * One merchant name the user answered by hand, carrying exactly one of the three answers
 *
 * A value left alone is not sent at all, and keeps what the importer does unasked: matching an
 * existing merchant by name, and creating one where nothing matches
 */
export interface TransactionImportMerchantMapping {
  source: string
  merchant_id?: string | null
  create?: TransactionImportCreateMerchant | null

  /** True to write no merchant for this value, so its rows are filed under the shared one */
  skip?: boolean
}

export interface TransactionImportCreateTag {
  name: string
}

/**
 * One tag name the user answered by hand, carrying exactly one of the three answers
 *
 * A value left alone is not sent at all, and keeps what the importer does unasked: matching the
 * user's tag of that name, whatever its capitals, and creating one where nothing matches
 */
export interface TransactionImportTagMapping {
  source: string
  tag_id?: string | null
  create?: TransactionImportCreateTag | null

  /** True to import this value's rows without the tag */
  skip?: boolean
}

/** The kinds of file whose rows are saved through the transaction import endpoints */
export type TransactionImportSource = 'generic' | 'ofx' | 'qif'

export interface TransactionImportRow {
  account_source: string
  category_source: string
  dt: string
  amount: string
  merchant_name?: string | null
  notes?: string | null
  tag_names: string[]

  /** Counterparty account source, null when the file does not state one and the money left the app */
  counterparty_account_source?: string | null

  /**
   * The bank account an OFX statement names and the bank's ID for the transaction, as the file wrote
   * them, both or neither. The server hashes the pair with a secret key before staging, so neither
   * is kept, and the save leaves the row out when its account already holds that hash
   */
  bank_account?: string | null
  bank_transaction?: string | null
}

export interface TransactionImportPayload {
  accounts: TransactionImportAccountMapping[]
  categories: TransactionImportCategoryMapping[]
  merchants: TransactionImportMerchantMapping[]
  tags: TransactionImportTagMapping[]
  rows: TransactionImportRow[]
}

/** One batch of a staged file, carrying the mappings its own rows reference */
export interface TransactionImportStageBatch {
  accounts: TransactionImportAccountMapping[]
  categories: TransactionImportCategoryMapping[]
  merchants: TransactionImportMerchantMapping[]
  tags: TransactionImportTagMapping[]
  rows: TransactionImportRow[]

  /** Where this batch starts in the file, which is what makes staging it twice harmless */
  start_row_index: number
}

export interface TransactionImportResponse {
  transactions_created: number

  /** Rows left out because their account already holds the bank's ID for them */
  transactions_already_imported: number
  accounts_created: number
  accounts_reused: number
  categories_created: number
  categories_reused: number
  merchants_created: number
  merchants_reused: number
  tags_created: number
  tags_reused: number
  affected_account_ids: string[]
  account_source_ids: Record<string, string>
  category_source_ids: Record<string, string>
  created_account_ids: string[]
  created_category_ids: string[]
  created_merchant_ids: string[]
  created_tag_ids: string[]
}

/** The separators a CSV import read its amounts with */
export type CsvImportAmountFormat = {
  decimal_separator: string
  grouping_separator: string
}

/**
 * How a CSV file was read, which the commit saves for the one personal account its rows go to and the
 * next file with the same headers starts from
 *
 * The formats and the column fields are plain strings, since a saved layout can name one the page has
 * since stopped offering, which the page then refuses rather than misreads
 */
export type CsvImportLayout = {
  headers: string[]
  delimiter: string

  /** Counted from 1 over the file's non-blank lines */
  header_row: number

  /** Each app field the file fills, mapped to the header holding it, never the account */
  column_map: Record<string, string>
  date_format: string
  amount_format: CsvImportAmountFormat
}

/** A layout saved for one of the user's own accounts */
export type SavedCsvImportLayout = CsvImportLayout & {
  account_id: string
}

/** The importer of the last import that wrote rows into one of the user's own accounts */
export type SavedAccountImportSource = {
  account_id: string
  source: 'generic' | 'firefly' | 'actual_budget' | 'ofx' | 'qif'
}

/** One OFX transaction asked about, with the account it would go into. Mirrors the API's held-bank-transactions item */
export type HeldBankTransactionItem = {
  account_id: string
  bank_account: string
  bank_transaction: string
}

/** The positions among the asked items that their account already holds */
export type HeldBankTransactionsResponse = {
  held: number[]
}

/**
 * What the answer to a held-bank-transactions check depends on besides the bank values: the staged
 * files, and each statement's position with the account it goes into. It is the query's cache key,
 * so it never holds a bank account or a bank ID
 */
export type HeldBankTransactionsScope = {
  fileIds: string[]
  statements: Array<[position: number, accountId: string]>
}
