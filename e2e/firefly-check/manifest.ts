/**
 * What a seeded Firefly III says is true, measured through its own API at one as-of date
 *
 * The comparison checks Lumina against this, so nothing in it is worked out the way Lumina's
 * importer works it out. Every amount is Firefly III's own decimal text, signed from the side of
 * the account it belongs to, and every list is sorted on stable keys so two seeds of the same
 * dataset write the same file
 */
export interface FireflyManifest {
  /** Last day measured. Rows after it are listed but counted nowhere */
  asOf: string

  /** First day the transactions export covers */
  exportStart: string
  accounts: ManifestAccount[]
  accountMonths: ManifestAccountMonth[]
  categoryMonths: ManifestCategoryMonth[]
  rows: ManifestRow[]
  budgets: ManifestBudget[]
}

/** Firefly III version and export window of one seed run, which change from run to run */
export interface FireflyRunInfo {
  fireflyVersion: string
  exportEnd: string
}

/** One asset or liability account, the only kinds Lumina imports */
export interface ManifestAccount {
  name: string

  /** Firefly III's account role for an asset, or its liability type */
  role: string
  liabilityDirection: string | null
  currency: string
  active: boolean

  /** Firefly III's own balance at the as-of date */
  balance: string

  /** Sum of every row on the account up to the as-of date, from the account's side */
  rowTotal: string
}

export interface ManifestAccountMonth {
  account: string
  month: string
  count: number
  total: string
}

/**
 * Spending or income in one category, from rows between an imported account and one outside the
 * import, the only rows a category is written on in Lumina
 */
export interface ManifestCategoryMonth {
  /** Blank for rows with no category */
  category: string
  month: string
  currency: string
  total: string
}

/** One split as Firefly III stores it, with the amount each imported side of it moves */
export interface ManifestRow {
  date: string
  type: string
  description: string
  groupTitle: string
  source: ManifestEndpoint
  destination: ManifestEndpoint
  category: string
  budget: string
  tags: string[]
  notes: string

  /** What the row cost in a currency none of its imported accounts is kept in, as a magnitude */
  foreign: { amount: string; currency: string } | null

  /** True for a row dated after the as-of date, which no export of the dataset window holds */
  afterAsOf: boolean
}

export interface ManifestEndpoint {
  name: string

  /** Firefly III's account type, such as "Asset account" or "Expense account" */
  type: string

  /** Whether the endpoint is an asset or liability account */
  imported: boolean

  /** Signed amount in the account's currency, null for an endpoint outside the import */
  amount: string | null
}

export interface ManifestBudget {
  name: string
  active: boolean
  limits: ManifestBudgetLimit[]
}

export interface ManifestBudgetLimit {
  start: string
  end: string
  amount: string
  currency: string
}
