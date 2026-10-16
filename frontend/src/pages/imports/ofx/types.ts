import type { AccountType } from '@/api/accounts'

/** Which kind of statement an OFX file holds: a bank account's or a credit card's */
export type OfxStatementKind = 'bank' | 'creditCard'

/**
 * One transaction of a statement, read the way the file states it
 *
 * `date` and `amount` are null where the file's value cannot be read, so the import can list the
 * transaction as skipped with its reason instead of refusing the whole file
 */
export interface OfxTransaction {
  /** Position among the statement's transactions, counted from 1 */
  index: number

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

/** One bank or credit card statement of an OFX file */
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
  leftOut: { investment: number; loan: number }
}

export type OfxFileRead =
  | { status: 'read'; file: OfxFile }
  | { status: 'refused'; reason: string }

/** One transaction the import leaves out, with enough of it for the user to find it in the file */
export interface OfxSkippedRow {
  id: string
  statementLabel: string

  /** The posted date as the preview shows dates, or as the file wrote it when it is not a real date */
  postedLabel: string
  amountText: string
  payee: string | null
  memo: string | null
  reason: string
}
