/**
 * What a seeded Actual Budget says is true about one budget, measured through its own API at one
 * as-of date, beside the budget figures the seed declared and found in the export's own table
 *
 * The comparison checks Lumina against this, so nothing in it is worked out the way Lumina's
 * importer works it out. Transaction amounts are Actual's hundredths as signed decimal text, budget
 * figures are in the decimal places Actual stored them in, and every list is sorted on stable keys
 */
export interface ActualManifest {
  /** The dataset's name, which also names its folder in output/ */
  budget: string

  /** The run date. Rows after it are listed but counted nowhere */
  asOf: string
  budgetType: 'envelope' | 'tracking'

  /** The currency Actual records, which it does only while its currency feature is on */
  currency: string | null

  /** Decimal places Actual stores this budget's figures in, from its own currency table */
  budgetDecimals: number

  /** Newest database migration in the export, which the importer's version guard reads */
  databaseVersion: number | null
  accounts: ManifestAccount[]
  categories: ManifestCategory[]
  categoryMonths: ManifestCategoryMonth[]

  /** What the seed set in the table of the budget type that is on, checked against the export */
  figures: ManifestFigure[]
  transfers: ManifestTransfer[]

  /** Rows dated after the as-of date, which the import leaves out and lists */
  afterAsOf: ManifestRow[]

  /** Split rows whose parts don't add up to them, which Actual flags */
  unbalancedSplits: ManifestRow[]
}

/** Actual version, run date and currency facts of one seed run, which change from run to run */
export interface ActualRunInfo {
  /** The version the Actual server reports */
  actualVersion: string

  /** The @actual-app/api version the seed wrote the budgets with */
  apiVersion: string
  asOf: string

  /** The timezone the seed took the as-of date in */
  timezone: string
  budgets: string[]

  /** What the importer was built for, read from its constants by seed.sh */
  importer: {
    newestCheckedMigration: number
    zeroDecimalCurrencies: string[]
  }

  /** What the installed Actual packages hold */
  actual: {
    zeroDecimalCurrencies: string[]

    /** Whether currency is still one of Actual's feature flags, which the importer reads */
    currencyIsFeatureFlag: boolean
    migrations: ActualMigration[]
  }
}

export interface ActualMigration {
  id: number
  file: string
}

/** One live Actual account, open or closed */
export interface ManifestAccount {
  id: string
  name: string
  offBudget: boolean
  closed: boolean

  /** What its rows add up to on the as-of date, which Actual's own balance is checked against */
  balance: string
}

export interface ManifestCategory {
  id: string
  name: string

  /** The name, with its group added when another category shares the name */
  label: string
  group: string
  isIncome: boolean

  /** Hidden itself or inside a hidden group */
  hidden: boolean
}

/**
 * What one live category moved in one month on the budget's own accounts, the only ones Actual
 * counts against a category
 */
export interface ManifestCategoryMonth {
  categoryId: string
  month: string
  total: string
}

export interface ManifestFigure {
  categoryId: string
  month: string
  amount: string
  carryover: boolean
}

/** One side of a transfer as Actual links it, from the account money leaves */
export interface ManifestTransfer {
  date: string
  account: string
  counterpartAccount: string
  amount: string
  category: string | null

  /** Whether the other side links back, which Actual doesn't require */
  linkedBothWays: boolean
}

/** One row as Actual shows it: a split part carries its parent's payee when it has none */
export interface ManifestRow {
  date: string
  account: string
  amount: string
  payee: string | null
  category: string | null
  notes: string | null
}

/** Decimal places Actual keeps every transaction in, whatever the budget's currency */
export const ACTUAL_TRANSACTION_DECIMALS = 2

/** Moves a YYYY-MM month by whole months */
export function shiftMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const index = year * 12 + monthNumber - 1 + offset
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

export function getMonthEnd(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0')}`
}

/** Writes an integer stored with some decimal places as signed decimal text */
export function formatStored(value: bigint | number, decimals: number): string {
  const units = BigInt(value)
  const sign = units < 0n ? '-' : ''
  const digits = (units < 0n ? -units : units).toString().padStart(decimals + 1, '0')
  return decimals === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
}

/** Reads decimal text into whole units of a scale, refusing any precision the scale can't hold */
export function readStored(amount: string, decimals: number): bigint {
  const match = amount.trim().match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if (!match) throw new Error(`Unreadable amount "${amount}"`)
  const [, sign, whole, fraction = ''] = match
  if (/[1-9]/.test(fraction.slice(decimals))) throw new Error(`Amount "${amount}" is more precise than ${decimals} decimal places`)
  const units = BigInt(whole + fraction.slice(0, decimals).padEnd(decimals, '0'))
  return sign ? -units : units
}

/** Orders by code point, so the manifest reads the same whatever locale the seed runs in */
export function compareText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0
}
