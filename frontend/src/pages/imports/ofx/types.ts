import type { AccountType } from '@/api/accounts'

/** Which kind of statement an OFX file holds: a bank account's, a credit card's or a loan's */
export type OfxStatementKind = 'bank' | 'creditCard' | 'loan'

/**
 * One transaction of a statement, read the way the file states it
 *
 * `date` and `amount` are null where the file's value cannot be read, so the import can list the
 * transaction as skipped with its reason instead of refusing the whole file
 */
export interface OfxTransaction {
  /** Position among the statement's transactions, counted from 1 across every file the statement is in */
  index: number

  /** Identifies the file the transaction was read from, which two files of one name do not share */
  fileId: string

  /** Position of that file among the staged files, counted from 1, which combining the files sets */
  fileOrder: number

  /** The name of that file, with its position added when another staged file has the same name */
  fileName: string

  /**
   * The bank account the statement names, as "bank:" and its routing ID and account number joined
   * by colons, "creditCard:" and the card number, or "loan:" and the loan account number. Sent with the bank's ID, so the server can
   * hash the pair, and never kept
   */
  bankAccountKey: string

  /** The bank's ID for the transaction as the file wrote it, or null where the file states none */
  bankTransactionId: string | null

  /** The posted date as the file wrote it, shown beside a transaction left out */
  postedText: string

  /** The posted date as YYYY-MM-DD, or null when the file's date is not a real one */
  date: string | null

  /** The amount as the file wrote it, shown beside a transaction left out */
  amountText: string

  /** The signed amount as plain decimal text with a period, or null when the file's is not a number */
  amount: string | null

  /** The payee name, the transaction's merchant */
  payee: string | null

  /** The memo, the transaction's note */
  memo: string | null

  /**
   * The currency the transaction's amount is stated in when its CURRENCY block names one other than
   * the statement's, an empty string where the block names none, or null when it has no such block.
   * The import takes amounts in the statement's currency, so such a transaction is left out rather
   * than imported in the wrong one
   */
  otherCurrency: string | null
}

/** One bank, credit card or loan statement of an OFX file */
export interface OfxStatement {
  /** Identifies the statement within the file, which the account answers are filed under */
  id: string
  kind: OfxStatementKind

  /** The name a new account is created under */
  name: string

  /** The name with the statement's currency, as the account step lists it */
  label: string

  /** The type a new account is proposed with */
  proposedType: AccountType

  /** The currency every transaction in the statement is in, as an upper-case code */
  currency: string
  transactions: OfxTransaction[]
}

/** Everything the import reads from an OFX file, before any account is answered */
export interface OfxFile {
  statements: OfxStatement[]

  /** Statements the import does not bring in, counted by what they hold */
  leftOut: { investment: number }
}

/** A statement file the flow has read, listed in the files step */
export interface OfxStagedFile {
  id: string
  name: string

  /** With the name and `lastModified`, tells a file picked twice from two files that share a name */
  size: number
  lastModified: number
  file: OfxFile
}

export type OfxFileRead = { status: 'read'; file: OfxFile } | { status: 'refused'; reason: string }

/** One transaction the import leaves out, with enough of it for the user to find it in the file */
export interface OfxSkippedRow {
  id: string
  fileName: string
  statementLabel: string

  /** The posted date as the preview shows dates, or as the file wrote it when it is not a real date */
  postedLabel: string
  amountText: string
  payee: string | null
  memo: string | null
  reason: string
}
