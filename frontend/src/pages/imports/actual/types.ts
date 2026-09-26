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
