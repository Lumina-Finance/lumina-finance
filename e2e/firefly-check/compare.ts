/**
 * Compares what Lumina holds after the import with what Firefly III says is true
 *
 * Pure, so the contract tests can feed it changed values without a browser. Every difference is
 * reported once per kind, subject and Lumina value, with a count where several records share one
 */
import type { FireflyManifest, FireflyRunInfo, ManifestEndpoint, ManifestRow } from './manifest.ts'
import { formatMinorUnits as formatBigMinorUnits, toMinorUnits as toBigMinorUnits } from './seed/record.ts'

export interface LuminaAccount {
  id: string
  name: string
  account_type: string
  currency: string
  current_balance: number
  is_archived: boolean
}

export interface LuminaTransaction {
  account_id: string
  dt: string

  /** In the account's currency, as the balance counts it */
  amount: number

  /** As recorded, in the transaction's own currency */
  original_amount: number
  currency: string
  merchant_name: string | null
  category_id: string
  notes: string | null
  tags: { name: string }[]
  counterparty_account_id: string | null
}

export interface LuminaBaseBudget {
  id: string
  name: string
  currency: string
  is_archived: boolean
  category_ids: string[]
}

export interface LuminaBudgetPeriod {
  base_budget_id: string
  period_start: string
  period_end: string
  overall_limit: number
}

/** Everything the comparison reads back from Lumina's API */
export interface LuminaSnapshot {
  accounts: LuminaAccount[]
  transactions: LuminaTransaction[]
  categories: { id: string; name: string }[]
  baseBudgets: LuminaBaseBudget[]
  budgetPeriods: LuminaBudgetPeriod[]
}

/** One asset or liability row of Firefly III's accounts export */
export interface FireflyAccountFileEntry {
  name: string
  type: string
  role: string
  currency: string
  active: boolean
}

export interface Difference {
  kind: string
  subject: string
  firefly: string
  lumina: string
}

/** A known difference, which matches only while Lumina still holds the value it names */
export interface ExpectedDifference {
  kind: string
  subject: string
  lumina: string
  reason: string
}

// The category rows with no category go to, and the ones Lumina files transfers and balance rows
// under, which carry no Firefly III category of their own
const NO_CATEGORY = 'Miscellaneous'
const TRANSFER = 'Transfer'
const BALANCE_ADJUSTMENT = 'Balance Adjustment'

// The Lumina account type each Firefly III account type or asset role stands for
const LUMINA_TYPE_BY_FIREFLY: Record<string, string> = {
  defaultAsset: 'checking',
  sharedAsset: 'checking',
  savingAsset: 'savings',
  ccAsset: 'credit_card',
  cashWalletAsset: 'cash',
  loan: 'loan',
  debt: 'line_of_credit',
  mortgage: 'mortgage',
}

export function compareImport(
  manifest: FireflyManifest,
  runInfo: FireflyRunInfo,
  accountsFile: FireflyAccountFileEntry[],
  lumina: LuminaSnapshot,
): Difference[] {
  const differences = new DifferenceList()
  const accountById = new Map(lumina.accounts.map((account) => [account.id, account]))
  const categoryNameById = new Map(lumina.categories.map((category) => [category.id, category.name]))

  // A row dated after the export's last day was never in the file, so it cannot be in Lumina
  const exportedRows = manifest.rows.filter((row) => row.date <= runInfo.exportEnd)

  // Rows dated after the manifest's day count toward no balance or total, though they still import
  const counted = { ...lumina, transactions: lumina.transactions.filter((transaction) => transaction.dt <= manifest.asOf) }

  const accountByName = compareAccounts(manifest, accountsFile, lumina, differences)
  compareAccountMonths(manifest, counted, accountById, differences)
  compareCategoryMonths(manifest, counted, accountById, categoryNameById, differences)
  compareRows(exportedRows, lumina, accountByName, accountById, categoryNameById, differences)
  compareBudgets(manifest, exportedRows, lumina, categoryNameById, differences)
  return differences.list()
}

/**
 * Splits the differences into those not on the expected list, and expected ones that no longer
 * occur, so a fixed gap has to be taken off the list
 */
export function checkExpected(differences: Difference[], expected: ExpectedDifference[]) {
  const matches = (difference: Difference, entry: ExpectedDifference) => (
    entry.kind === difference.kind && entry.subject === difference.subject && entry.lumina === difference.lumina
  )
  return {
    unexpected: differences.filter((difference) => !expected.some((entry) => matches(difference, entry))),
    stale: expected.filter((entry) => !differences.some((difference) => matches(difference, entry))),
  }
}

/** Compares the accounts both ways, and returns Lumina's accounts by name for the other checks */
function compareAccounts(
  manifest: FireflyManifest,
  accountsFile: FireflyAccountFileEntry[],
  lumina: LuminaSnapshot,
  differences: DifferenceList,
) {
  const accountByName = new Map<string, LuminaAccount>()
  for (const account of lumina.accounts) {
    if (accountByName.has(account.name)) differences.add('account-duplicate', account.name, 'one account', 'more than one')
    accountByName.set(account.name, account)
  }

  const manifestNames = new Set(manifest.accounts.map((account) => account.name))
  for (const account of manifest.accounts) {
    const found = accountByName.get(account.name)
    if (!found) {
      differences.add('account-missing', account.name, 'present', 'absent')
      continue
    }
    const balance = formatMinorUnits(found.current_balance, found.currency)
    if (balance !== account.balance) differences.add('balance', account.name, account.balance, balance)
  }
  for (const account of lumina.accounts.filter((entry) => !manifestNames.has(entry.name))) {
    differences.add('account-extra', account.name, 'absent', account.account_type)
  }

  // Read from the accounts export rather than the API, so a change to that file's format shows up
  // here instead of quietly leaving an account unchecked
  const fileNames = new Set(accountsFile.map((entry) => entry.name))
  for (const name of manifestNames) {
    if (!fileNames.has(name)) differences.add('accounts-file', name, 'in the accounts export', 'not read from it')
  }
  for (const entry of accountsFile) {
    if (!manifestNames.has(entry.name)) differences.add('accounts-file', entry.name, 'not an account', 'read from the accounts export')
    const found = accountByName.get(entry.name)
    if (!found) continue

    const expectedType = LUMINA_TYPE_BY_FIREFLY[entry.role || entry.type.toLowerCase()] ?? `unknown (${entry.role || entry.type})`
    if (found.account_type !== expectedType) differences.add('account-type', entry.name, expectedType, found.account_type)
    if (found.currency !== entry.currency) differences.add('account-currency', entry.name, entry.currency, found.currency)
    if (found.is_archived === entry.active) {
      differences.add('account-archived', entry.name, entry.active ? 'active' : 'inactive', found.is_archived ? 'archived' : 'active')
    }
  }
  return accountByName
}

function compareAccountMonths(
  manifest: FireflyManifest,
  lumina: LuminaSnapshot,
  accountById: Map<string, LuminaAccount>,
  differences: DifferenceList,
) {
  const luminaMonths = new Map<string, { count: number; total: number }>()
  for (const transaction of lumina.transactions) {
    const account = accountById.get(transaction.account_id)
    if (!account) continue
    const key = JSON.stringify([account.name, transaction.dt.slice(0, 7)])
    const entry = luminaMonths.get(key) ?? { count: 0, total: 0 }
    entry.count += 1
    entry.total += transaction.amount
    luminaMonths.set(key, entry)
  }

  const currencyByAccount = new Map(manifest.accounts.map((account) => [account.name, account.currency]))
  const seen = new Set<string>()
  for (const month of manifest.accountMonths) {
    const key = JSON.stringify([month.account, month.month])
    seen.add(key)
    const found = luminaMonths.get(key) ?? { count: 0, total: 0 }
    const total = formatMinorUnits(found.total, currencyByAccount.get(month.account) ?? '')
    if (found.count !== month.count || total !== month.total) {
      differences.add('account-month', `${month.account} ${month.month}`, `${month.count} rows, ${month.total}`, `${found.count} rows, ${total}`)
    }
  }
  for (const [key, found] of luminaMonths) {
    if (seen.has(key)) continue
    const [account, month] = JSON.parse(key) as [string, string]
    differences.add('account-month', `${account} ${month}`, '0 rows', `${found.count} rows`)
  }
}

function compareCategoryMonths(
  manifest: FireflyManifest,
  lumina: LuminaSnapshot,
  accountById: Map<string, LuminaAccount>,
  categoryNameById: Map<string, string>,
  differences: DifferenceList,
) {
  // Only rows with a payee of their own carry a category, so transfer legs and balance rows are out
  const luminaTotals = new Map<string, number>()
  for (const transaction of lumina.transactions) {
    const account = accountById.get(transaction.account_id)
    const category = categoryNameById.get(transaction.category_id) ?? ''
    if (!account || transaction.counterparty_account_id || category === BALANCE_ADJUSTMENT) continue
    const key = JSON.stringify([category, transaction.dt.slice(0, 7), account.currency])
    luminaTotals.set(key, (luminaTotals.get(key) ?? 0) + transaction.amount)
  }

  const seen = new Set<string>()
  for (const month of manifest.categoryMonths) {
    const category = month.category || NO_CATEGORY
    const key = JSON.stringify([category, month.month, month.currency])
    seen.add(key)
    const total = formatMinorUnits(luminaTotals.get(key) ?? 0, month.currency)
    if (total !== month.total) {
      differences.add('category-month', `${category} ${month.month} ${month.currency}`, month.total, total)
    }
  }
  for (const [key, total] of luminaTotals) {
    if (seen.has(key)) continue
    const [category, month, currency] = JSON.parse(key) as [string, string, string]
    differences.add('category-month', `${category} ${month} ${currency}`, '0', formatMinorUnits(total, currency))
  }
}

/**
 * Matches every Firefly III row to the Lumina rows it became, by account, date, amount and
 * counterparty, then compares what each carries. Lumina rows left over were never in Firefly III
 */
function compareRows(
  rows: ManifestRow[],
  lumina: LuminaSnapshot,
  accountByName: Map<string, LuminaAccount>,
  accountById: Map<string, LuminaAccount>,
  categoryNameById: Map<string, string>,
  differences: DifferenceList,
) {
  const unmatched = new Set(lumina.transactions)
  const take = (endpoint: ManifestEndpoint, date: string, counterparty: LuminaAccount | null, prefer?: (transaction: LuminaTransaction) => boolean) => {
    const account = accountByName.get(endpoint.name)
    if (!account || endpoint.amount === null) return null
    const amount = toMinorUnits(endpoint.amount, account.currency)
    const candidates = [...unmatched].filter((transaction) => (
      transaction.account_id === account.id
      && transaction.dt.slice(0, 10) === date
      && transaction.amount === amount
      && transaction.counterparty_account_id === (counterparty?.id ?? null)
    ))
    const match = candidates.find((transaction) => prefer?.(transaction)) ?? candidates[0] ?? null
    if (match) unmatched.delete(match)
    return match
  }

  // What every row Lumina writes from one Firefly III row should carry
  const compareText = (subject: string, row: ManifestRow, match: LuminaTransaction) => {
    const tags = match.tags.map((tag) => tag.name).sort()
    if (tags.join('|') !== row.tags.join('|')) differences.add('row-tags', subject, row.tags.join(' | '), tags.join(' | '))

    const notes = [row.description, row.groupTitle ? `Split transaction: ${row.groupTitle}` : '', row.notes]
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n')
    if ((match.notes ?? '') !== notes) differences.add('row-notes', subject, describeText(notes), describeText(match.notes ?? ''))
  }

  for (const row of rows) {
    const subject = `${row.date} ${row.description}`

    if (row.source.imported && row.destination.imported && !isBalanceRow(row)) {
      const source = accountByName.get(row.source.name) ?? null
      const destination = accountByName.get(row.destination.name) ?? null
      const legs = [take(row.source, row.date, destination), take(row.destination, row.date, source)]
      if (legs.some((leg) => !leg)) differences.add('transfer-missing', subject, `${row.source.name} → ${row.destination.name}`, 'absent')
      for (const leg of legs) {
        if (!leg) continue
        const category = categoryNameById.get(leg.category_id) ?? ''
        if (category !== TRANSFER) differences.add('transfer-category', subject, TRANSFER, category)

        // Kept apart from the check above so the loss is listed once per Firefly III category
        if (row.category && category !== row.category) differences.add('transfer-category-dropped', row.category, row.category, category)
        compareText(subject, row, leg)
      }
      continue
    }

    const side = getImportedSide(row)
    if (!side) {
      differences.add('row-not-importable', subject, row.type, 'no imported account')
      continue
    }
    const payee = side === row.source ? row.destination.name : row.source.name
    const match = take(side, row.date, null, (transaction) => transaction.merchant_name === payee)
    if (!match) {
      differences.add('row-missing', subject, `${side.amount} on ${side.name}`, 'absent')
      continue
    }
    if (isBalanceRow(row)) continue

    if (match.merchant_name !== payee) differences.add('row-payee', subject, payee, match.merchant_name ?? '')
    const category = categoryNameById.get(match.category_id) ?? ''
    if (category !== (row.category || NO_CATEGORY)) differences.add('row-category', subject, row.category || NO_CATEGORY, category)
    compareText(subject, row, match)

    // A row paid in a currency other than its account's keeps what it cost in that currency
    if (row.foreign) {
      const original = `${formatMinorUnits(Math.abs(match.original_amount), match.currency)} ${match.currency}`
      const expected = `${row.foreign.amount} ${row.foreign.currency}`
      if (original !== expected) {
        const held = match.currency === row.foreign.currency ? original : `${match.currency} only`
        differences.add('row-foreign-amount', row.description, expected, held)
      }
    }
  }

  for (const transaction of unmatched) {
    const account = accountById.get(transaction.account_id)
    differences.add(
      'row-extra',
      `${transaction.dt.slice(0, 10)} ${account?.name ?? transaction.account_id} ${transaction.amount}`,
      'absent',
      transaction.merchant_name ?? '',
    )
  }
}

function compareBudgets(
  manifest: FireflyManifest,
  rows: ManifestRow[],
  lumina: LuminaSnapshot,
  categoryNameById: Map<string, string>,
  differences: DifferenceList,
) {
  const baseBudgetByName = new Map<string, LuminaBaseBudget>()
  for (const budget of lumina.baseBudgets) {
    if (baseBudgetByName.has(budget.name)) differences.add('budget-duplicate', budget.name, 'one budget', 'more than one')
    baseBudgetByName.set(budget.name, budget)
  }
  const manifestNames = new Set(manifest.budgets.map((budget) => budget.name))
  for (const budget of lumina.baseBudgets.filter((entry) => !manifestNames.has(entry.name))) {
    differences.add('budget-extra', budget.name, 'absent', 'present')
  }

  for (const budget of manifest.budgets) {
    const luminaBudget = baseBudgetByName.get(budget.name)
    if (!luminaBudget) {
      differences.add('budget-missing', budget.name, `${budget.limits.length} limits`, 'absent')
      continue
    }
    if (luminaBudget.is_archived === budget.active) {
      differences.add('budget-archived', budget.name, budget.active ? 'active' : 'inactive', luminaBudget.is_archived ? 'archived' : 'active')
    }

    // A budget counts the categories of the spending Firefly III filed under it. Spending with no
    // category gives it nothing to track
    const categories = [...new Set(rows
      .filter((row) => row.budget === budget.name && row.category && getPayeeSide(row))
      .map((row) => row.category))].sort()
    const tracked = luminaBudget.category_ids.map((id) => categoryNameById.get(id) ?? id).sort()
    if (tracked.join('|') !== categories.join('|')) {
      differences.add('budget-categories', budget.name, categories.join(' | '), tracked.join(' | '))
    }

    const periods = lumina.budgetPeriods
      .filter((period) => period.base_budget_id === luminaBudget.id)
      .map((period) => `${period.period_start} ${period.period_end} ${formatMinorUnits(period.overall_limit, luminaBudget.currency)} ${luminaBudget.currency}`)
      .sort()
    const limits = budget.limits.map((limit) => `${limit.start} ${limit.end} ${limit.amount} ${limit.currency}`).sort()
    for (const limit of limits.filter((entry) => !periods.includes(entry))) {
      differences.add('budget-period-missing', `${budget.name} ${limit}`, limit, 'absent')
    }
    for (const period of periods.filter((entry) => !limits.includes(entry))) {
      differences.add('budget-period-extra', `${budget.name} ${period}`, 'absent', period)
    }
  }
}

/** The one imported side of a row between an imported account and one outside, or of a balance row */
function getImportedSide(row: ManifestRow): ManifestEndpoint | null {
  if (isBalanceRow(row)) return row.destination.imported ? row.destination : row.source.imported ? row.source : null
  return getPayeeSide(row)
}

/** The imported side of a withdrawal from, or deposit into, an imported account, with the other side outside */
function getPayeeSide(row: ManifestRow): ManifestEndpoint | null {
  if (row.type === 'withdrawal' && row.source.imported && !row.destination.imported) return row.source
  if (row.type === 'deposit' && row.destination.imported && !row.source.imported) return row.destination
  return null
}

function isBalanceRow(row: ManifestRow) {
  return row.type === 'opening balance' || row.type === 'reconciliation'
}

function describeText(text: string) {
  return text.length > 80 ? `${text.slice(0, 60)}… (${text.length} characters)` : text
}

function toMinorUnits(amount: string, currency: string) {
  return Number(toBigMinorUnits(amount, currency))
}

function formatMinorUnits(minorUnits: number, currency: string) {
  return formatBigMinorUnits(BigInt(minorUnits), currency)
}

/** Keeps one difference per kind, subject and Lumina value, counting repeats */
class DifferenceList {
  private readonly entries = new Map<string, Difference & { count: number }>()

  add(kind: string, subject: string, firefly: string, lumina: string) {
    const key = JSON.stringify([kind, subject, lumina])
    const entry = this.entries.get(key)
    if (entry) {
      entry.count += 1
    } else {
      this.entries.set(key, { kind, subject, firefly, lumina, count: 1 })
    }
  }

  list(): Difference[] {
    return [...this.entries.values()].map(({ count, ...difference }) => (
      count > 1 ? { ...difference, firefly: `${difference.firefly} (${count} times)` } : difference
    ))
  }
}
