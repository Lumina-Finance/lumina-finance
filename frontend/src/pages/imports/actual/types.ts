import type { AccountType } from '@/api/accounts'

/** Which of Actual's two budget kinds a file has switched on */
export type ActualBudgetType = 'envelope' | 'tracking'

export interface ActualAccount {
  id: string
  name: string
  offBudget: boolean
  closed: boolean

  /** Actual's own account type, which is often empty */
  type: string | null
}

export interface ActualPayee {
  id: string
  name: string

  /** The live account a transfer payee stands for */
  transferAccountId: string | null
}

export interface ActualCategory {
  id: string
  name: string

  /** Actual lets two groups each hold a category of the same name, so the group tells them apart */
  groupName: string | null
  isIncome: boolean

  /** Hidden itself or inside a hidden group */
  hidden: boolean
}

/**
 * One live transaction row in a live account, read the way Actual's own screens show it: payees
 * and categories resolve through Actual's merges, and one that was deleted reads as null
 *
 * `amount` is the integer Actual stored, which is in hundredths whatever the budget's currency
 */
export interface ActualTransaction {
  id: string
  accountId: string
  date: string
  amount: number
  payeeId: string | null
  categoryId: string | null
  notes: string | null

  /** A split parent, whose children carry the amounts and categories */
  isParent: boolean
  parentId: string | null

  /** The other leg of a transfer, when Actual linked one */
  transferredId: string | null
  isStartingBalance: boolean
}

/**
 * One month's figure for one category, from the table of the budget type the file has switched on
 *
 * `amount` is the integer Actual stored, in the scale given by the file's `budgetDecimals`
 */
export interface ActualBudgetFigure {
  month: string
  categoryId: string
  amount: number
  carryover: boolean
}

/** Everything the import reads from an Actual Budget file, before any mapping */
export interface ActualBudgetFile {
  budgetName: string | null

  /** Newest migration Actual applied to the file, which identifies the version that wrote it */
  databaseVersion: number | null
  budgetType: ActualBudgetType

  /** Set only when the file has Actual's currency feature on and a default currency chosen */
  currencyCode: string | null

  /** Decimal places Actual stored budget figures in */
  budgetDecimals: number
  accounts: ActualAccount[]
  payees: ActualPayee[]
  categories: ActualCategory[]
  transactions: ActualTransaction[]
  budgetFigures: ActualBudgetFigure[]
}

export type ActualFileRead =
  | { status: 'read'; budget: ActualBudgetFile }
  | { status: 'refused'; reason: string }

/** What an Actual category source files rows under, which decides its label and default */
export type ActualCategoryRole =
  /** Ordinary rows carrying the category */
  | 'spending'

  /** The budget-side leg of transfers to or from off-budget accounts that carry the category */
  | 'transfer'

  /** Budget-side rows with no category */
  | 'uncategorized'

  /** Rows with no category in one off-budget account, where Actual never asks for one */
  | 'offBudgetUncategorized'

/**
 * One Actual account the import writes to, which the user links to a Lumina account or creates
 *
 * `id` is Actual's own account id, which the mappings and the upload name the account by, since
 * Actual lets two accounts share a name
 */
export interface ActualAccountSource {
  id: string
  name: string

  /** The name, with a note added when another account shares it */
  label: string
  offBudget: boolean
  closed: boolean

  /** Hundredths left in the account once the imported rows are written */
  balance: number
  rowCount: number

  /** What a new Lumina account is proposed as, read from Actual's own type and the balance */
  proposedType: AccountType
}

/**
 * One category mapping source, which the categories step matches to a Lumina category or creates
 *
 * `id` is what the upload names it by: Actual's category id for spending, prefixed for the other
 * roles, so two Actual categories sharing a name stay apart
 */
export interface ActualCategorySource {
  id: string
  role: ActualCategoryRole

  /** What the categories step shows */
  label: string

  /** The name a new Lumina category is created under */
  createName: string

  /** Actual's category, null for the uncategorized roles */
  categoryId: string | null

  /** The off-budget account an uncategorized source belongs to */
  accountId: string | null
  isIncome: boolean
  rowCount: number
}

export type ActualJournalType = 'withdrawal' | 'deposit' | 'transfer' | 'opening balance'

/**
 * One row the import uploads, still in Actual's terms: accounts are Actual account ids, and the
 * amount is the magnitude in hundredths, which becomes decimal text once each account's currency
 * is known
 */
export interface ActualJournalEntry {
  transactionId: string
  date: string
  type: ActualJournalType
  amount: number

  /** The account money leaves, null when it leaves from outside the import */
  sourceAccountId: string | null

  /** The account money enters, null when it goes outside the import */
  destinationAccountId: string | null

  /** The payee, which becomes the merchant on a withdrawal or deposit */
  payeeName: string | null
  categorySourceId: string | null

  /** Set on a categorized transfer, naming the leg on the budget side */
  categoryLeg: 'source' | 'destination' | null
  notes: string | null
  tags: string[]
}

/** One Actual row the import leaves out, with enough of it for the user to find it in Actual */
export interface ActualSkippedRow {
  transactionId: string
  date: string
  accountName: string

  /** Signed hundredths, as Actual shows the row */
  amount: number
  payeeName: string | null
  categoryName: string | null
  notes: string | null
  reason: string
}

/** Everything the import takes from an Actual budget, before any account or category is answered */
export interface ActualJournal {
  accounts: ActualAccountSource[]
  categories: ActualCategorySource[]
  entries: ActualJournalEntry[]
  skippedRows: ActualSkippedRow[]
}
