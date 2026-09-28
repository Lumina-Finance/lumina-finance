/**
 * Compares what Lumina holds after importing one Actual budget with what Actual says is true
 *
 * Pure, so it can be fed changed values without a browser. Accounts, categories and budgets are
 * paired by Actual's own ids through the mappings the import run reported, never by name, since
 * Actual lets two categories share one. Every difference is reported once per kind, subject and
 * Lumina value, with a count where several records share one
 */
import type { LuminaBaseBudget, LuminaSnapshot } from '../firefly-check/compare.ts'
import {
  ACTUAL_TRANSACTION_DECIMALS,
  formatStored,
  getMonthEnd,
  readStored,
  type ActualManifest,
  type ManifestCategory,
  type ManifestRow,
} from './manifest.ts'

/**
 * Lumina's records as the Firefly III check reads them back. The base budget list also sends each
 * budget's recurs flag, which that check's type leaves out
 */
export type ActualLuminaSnapshot = Omit<LuminaSnapshot, 'baseBudgets'> & { baseBudgets: (LuminaBaseBudget & { recurs: boolean })[] }

/** Lumina's records for Actual's, as the import run reported creating or matching them */
export interface ImportMappings {
  /** Lumina account id for each Actual account id */
  accounts: Map<string, string>

  /** Lumina category id for each category source the import uploaded */
  categories: Map<string, string>

  /** Lumina base budget id for each Actual category id a budget was imported for */
  budgets: Map<string, string>
}

export interface Difference {
  kind: string
  subject: string
  actual: string
  lumina: string
}

/** A known difference, which matches only while Lumina still holds the value it names */
export interface ExpectedDifference {
  kind: string
  subject: string
  lumina: string
  reason: string
}

/** One row of the import screen's table of rows it left out, as the screen shows it */
export interface SkippedRowCells {
  date: string
  reason: string
  account: string
  amount: string
  payee: string
}

// The system category Lumina files opening balances and the adjustment that archiving writes under
const BALANCE_ADJUSTMENT = 'Balance Adjustment'

// Decimal places Lumina keeps for the currencies the check's budgets are imported in
const CURRENCY_EXPONENTS: Record<string, number> = { CAD: 2, JPY: 0 }

// The start of the reason the import screen gives for a split whose parts no longer add up
const UNBALANCED_SPLIT_REASON = 'Its split parts add up to'

export function compareImport(
  manifest: ActualManifest,
  lumina: ActualLuminaSnapshot,
  mappings: ImportMappings,
  currency: string,
): Difference[] {
  const differences = new DifferenceList()
  const categoryById = new Map(manifest.categories.map((category) => [category.id, category]))

  // Actual's figures are as of the run date, so rows dated after it are compared on their own
  const counted = lumina.transactions.filter((transaction) => transaction.dt.slice(0, 10) <= manifest.asOf)

  compareAccounts(manifest, lumina, mappings, currency, differences)
  compareLaterRows(manifest, lumina.transactions, mappings, currency, differences)
  compareTransfers(manifest, counted, mappings, currency, differences)
  compareCategoryMonths(manifest, counted, mappings, categoryById, currency, differences)
  compareBudgets(manifest, lumina, mappings, categoryById, currency, differences)
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

/**
 * Compares the import screen's table of rows it left out, row by row, with the splits Actual flags
 * as unbalanced
 */
export function compareSkippedRows(manifest: ActualManifest, shown: SkippedRowCells[]): Difference[] {
  const differences = new DifferenceList()
  const expected = manifest.unbalancedSplits.map((row) => ({ row, reason: UNBALANCED_SPLIT_REASON }))
  const unmatched = new Set(shown)
  for (const { row, reason } of expected) {
    const subject = `${row.date} ${row.account} ${row.amount}`
    const match = [...unmatched].find((cells) => isSameRow(cells, row))
    if (!match) {
      differences.add('skipped-row-missing', subject, reason, 'not listed')
      continue
    }
    unmatched.delete(match)
    if (!match.reason.startsWith(reason)) differences.add('skipped-row-reason', subject, reason, match.reason)
  }
  for (const cells of unmatched) {
    differences.add('skipped-row-extra', `${cells.date} ${cells.account} ${cells.amount}`, 'not left out', cells.reason)
  }
  return differences.list()
}

function isSameRow(cells: SkippedRowCells, row: ManifestRow) {
  // The screen writes amounts in the budget's own decimal places, so they are compared as numbers
  return cells.date === row.date
    && cells.account === row.account
    && Number(cells.amount.replace(/,/g, '')) === Number(row.amount)
    && cells.payee === (row.payee ?? '')
}

function compareAccounts(
  manifest: ActualManifest,
  lumina: ActualLuminaSnapshot,
  mappings: ImportMappings,
  currency: string,
  differences: DifferenceList,
) {
  const accountById = new Map(lumina.accounts.map((account) => [account.id, account]))
  const adjustmentCategoryIds = new Set(lumina.categories.filter((category) => category.name === BALANCE_ADJUSTMENT).map((category) => category.id))
  const paired = new Set<string>()
  for (const account of manifest.accounts) {
    const found = accountById.get(mappings.accounts.get(account.id) ?? '')
    if (!found) {
      differences.add('account-missing', account.name, 'present', 'absent')
      continue
    }
    paired.add(found.id)

    // Archiving brings an account to zero with an adjustment dated the run date, which would hide
    // any error in its rows, so an archived account's balance is compared without it and the
    // adjustment is held to minus Actual's balance
    const archiveAdjustment = found.is_archived
      ? lumina.transactions
        .filter((transaction) => (
          transaction.account_id === found.id
          && transaction.dt.slice(0, 10) === manifest.asOf
          && adjustmentCategoryIds.has(transaction.category_id)
        ))
        .reduce((sum, transaction) => sum + transaction.amount, 0)
      : 0
    const balance = toCurrency(account.balance, ACTUAL_TRANSACTION_DECIMALS, currency)
    const luminaBalance = formatMinorUnits(found.current_balance - archiveAdjustment, found.currency)
    if (luminaBalance !== balance) differences.add('balance', account.name, balance, luminaBalance)
    if (found.is_archived) {
      const expectedAdjustment = toCurrency(negate(account.balance), ACTUAL_TRANSACTION_DECIMALS, currency)
      const heldAdjustment = formatMinorUnits(archiveAdjustment, found.currency)
      if (heldAdjustment !== expectedAdjustment) differences.add('archive-adjustment', account.name, expectedAdjustment, heldAdjustment)
    }
    if (found.currency !== currency) differences.add('account-currency', account.name, currency, found.currency)
    // A closed account holding rows dated after the run date can't be archived, so it comes in open
    const expectArchived = account.closed && !manifest.afterAsOf.some((row) => row.account === account.name)
    if (found.is_archived !== expectArchived) {
      differences.add('account-archived', account.name, expectArchived ? 'archived' : 'active', found.is_archived ? 'archived' : 'active')
    }
  }
  for (const account of lumina.accounts.filter((entry) => !paired.has(entry.id))) {
    differences.add('account-extra', account.name, 'absent', account.account_type)
  }
}

/**
 * Compares each row Actual dates after the run date with the Lumina row on its account on that
 * day for that amount, filed under what its category became, and reports any Lumina row dated
 * after the run date that answers none. Each Lumina row answers one Actual row
 */
function compareLaterRows(
  manifest: ActualManifest,
  transactions: LuminaSnapshot['transactions'],
  mappings: ImportMappings,
  currency: string,
  differences: DifferenceList,
) {
  const unmatched = new Set(transactions.filter((transaction) => transaction.dt.slice(0, 10) > manifest.asOf))
  for (const row of manifest.afterAsOf) {
    const accountId = findLuminaAccountId(manifest, mappings, row.account)
    const amount = toCurrency(row.amount, ACTUAL_TRANSACTION_DECIMALS, currency)
    const luminaCategoryId = row.categoryId ? mappings.categories.get(row.categoryId) ?? '' : null
    const onDay = [...unmatched].filter((transaction) => (
      transaction.account_id === accountId
      && transaction.dt.slice(0, 10) === row.date
      && formatMinorUnits(transaction.amount, currency) === amount
    ))
    const match = onDay.find((transaction) => luminaCategoryId === null || transaction.category_id === luminaCategoryId)
    const subject = `${row.date} ${row.account} ${amount}`
    if (match) {
      unmatched.delete(match)
    } else {
      differences.add('later-row', subject, row.category ?? 'imported', onDay.length > 0 ? 'another category' : 'absent')
    }
  }
  for (const transaction of unmatched) {
    differences.add('later-row-extra', `${transaction.dt.slice(0, 10)} ${formatMinorUnits(transaction.amount, currency)}`, 'absent', 'present')
  }
}

/**
 * Compares each transfer whose sides Actual links both ways, the ones the import pairs, with the
 * two legs Lumina holds for it: one on each account, naming the other, on the same day for
 * opposite amounts. A side on the budget that carries a category is spending in it, as the check
 * files it, and names no other account, and so does a pair imported as two one-sided
 * rows. The manifest names a transfer's accounts rather than giving their ids, so they are found
 * by name
 */
function compareTransfers(
  manifest: ActualManifest,
  transactions: LuminaSnapshot['transactions'],
  mappings: ImportMappings,
  currency: string,
  differences: DifferenceList,
) {
  const getLuminaAccountId = (name: string) => findLuminaAccountId(manifest, mappings, name)

  // Each leg answers one transfer, so two alike on one day need two pairs
  const unmatched = new Set(transactions)
  const takeLeg = (accountId: string | undefined, counterpartyId: string | null | undefined, date: string, amount: string) => {
    const leg = [...unmatched].find((transaction) => (
      transaction.account_id === accountId
      && transaction.counterparty_account_id === counterpartyId
      && transaction.dt.slice(0, 10) === date
      && formatMinorUnits(transaction.amount, currency) === amount
    ))
    if (leg) unmatched.delete(leg)
    return leg
  }

  const isOnBudget = (name: string) => manifest.accounts.some((account) => account.name === name && !account.offBudget)
  const isSpendingSide = (name: string, category: string | null) => Boolean(category) && isOnBudget(name)

  for (const transfer of manifest.transfers.filter((entry) => entry.linkedBothWays)) {
    const amount = toCurrency(transfer.amount, ACTUAL_TRANSACTION_DECIMALS, currency)
    const source = getLuminaAccountId(transfer.account)
    const destination = getLuminaAccountId(transfer.counterpartAccount)
    const sourceLeg = takeLeg(
      source,
      isSpendingSide(transfer.account, transfer.category) ? null : destination,
      transfer.date,
      toCurrency(negate(transfer.amount), ACTUAL_TRANSACTION_DECIMALS, currency),
    )
    const destinationLeg = takeLeg(destination, isSpendingSide(transfer.counterpartAccount, transfer.counterpartCategory) ? null : source, transfer.date, amount)
    if (sourceLeg && destinationLeg) continue
    const held = sourceLeg ? `only the ${transfer.account} leg` : destinationLeg ? `only the ${transfer.counterpartAccount} leg` : 'absent'
    differences.add('transfer', `${transfer.date} ${transfer.account} → ${transfer.counterpartAccount} ${amount}`, 'paired', held)
  }
}

/**
 * Compares each Actual category's month totals with what Lumina files under the category its rows
 * went to. Lumina counts a category on every account, and Actual only on the budget's own, so the
 * two agree only because payments to off-budget accounts carry the category on their budget side
 * alone, where the check files them as spending
 */
function compareCategoryMonths(
  manifest: ActualManifest,
  transactions: LuminaSnapshot['transactions'],
  mappings: ImportMappings,
  categoryById: Map<string, ManifestCategory>,
  currency: string,
  differences: DifferenceList,
) {
  const actualTotals = new Map<string, Map<string, string>>()
  for (const month of manifest.categoryMonths) {
    const months = actualTotals.get(month.categoryId) ?? new Map<string, string>()
    months.set(month.month, month.total)
    actualTotals.set(month.categoryId, months)
  }

  for (const [categoryId, months] of actualTotals) {
    const label = requireCategory(categoryById, categoryId).label
    const luminaId = mappings.categories.get(categoryId)
    if (!luminaId) {
      const total = [...months.values()].reduce((sum, value) => sum + readStored(value, ACTUAL_TRANSACTION_DECIMALS), 0n)
      differences.add('category-not-imported', label, toCurrency(formatStored(total, ACTUAL_TRANSACTION_DECIMALS), ACTUAL_TRANSACTION_DECIMALS, currency), 'absent')
      continue
    }

    const luminaMonths = new Map<string, number>()
    for (const transaction of transactions.filter((entry) => entry.category_id === luminaId)) {
      const month = transaction.dt.slice(0, 7)
      luminaMonths.set(month, (luminaMonths.get(month) ?? 0) + transaction.amount)
    }
    for (const month of [...new Set([...months.keys(), ...luminaMonths.keys()])].sort()) {
      const expected = toCurrency(months.get(month) ?? '0', ACTUAL_TRANSACTION_DECIMALS, currency)
      const held = formatMinorUnits(luminaMonths.get(month) ?? 0, currency)
      if (held !== expected) differences.add('category-month', `${label} ${month}`, expected, held)
    }
  }
}

function compareBudgets(
  manifest: ActualManifest,
  lumina: ActualLuminaSnapshot,
  mappings: ImportMappings,
  categoryById: Map<string, ManifestCategory>,
  currency: string,
  differences: DifferenceList,
) {
  const baseBudgetById = new Map(lumina.baseBudgets.map((budget) => [budget.id, budget]))
  const categoryNameById = new Map(lumina.categories.map((category) => [category.id, category.name]))
  const currentMonth = manifest.asOf.slice(0, 7)
  const paired = new Set<string>()

  const figuresByCategory = new Map<string, ActualManifest['figures']>()
  for (const figure of manifest.figures) {
    figuresByCategory.set(figure.categoryId, [...(figuresByCategory.get(figure.categoryId) ?? []), figure])
  }

  for (const [categoryId, figures] of figuresByCategory) {
    const category = requireCategory(categoryById, categoryId)
    const budget = baseBudgetById.get(mappings.budgets.get(categoryId) ?? '')
    if (!budget) {
      differences.add('budget-missing', category.label, `${figures.length} months`, 'absent')
      continue
    }
    paired.add(budget.id)

    if (budget.is_archived !== category.hidden) {
      differences.add('budget-archived', category.label, category.hidden ? 'hidden' : 'shown', budget.is_archived ? 'archived' : 'active')
    }
    if (budget.currency !== currency) differences.add('budget-currency', category.label, currency, budget.currency)

    // A budget carries on past its figures only while Actual still budgets the category this month or later
    const recurs = figures.some((figure) => figure.month >= currentMonth)
    if (budget.recurs !== recurs) {
      differences.add('budget-recurrence', category.label, recurs ? 'recurs' : 'ends', budget.recurs ? 'recurs' : 'ends')
    }
    if (figures.some((figure) => figure.carryover)) differences.add('budget-carryover', category.label, 'carries over', 'no carryover')

    // A budget tracks only the category its spending was filed under, as one made in the app does
    const tracked = budget.category_ids.map((id) => categoryNameById.get(id) ?? id).sort()
    const spendingId = mappings.categories.get(categoryId)
    const expectedTracked = spendingId ? [categoryNameById.get(spendingId) ?? spendingId] : []
    if (tracked.join('|') !== expectedTracked.join('|')) {
      differences.add('budget-categories', category.label, expectedTracked.join(' | '), tracked.join(' | '))
    }

    const periods = lumina.budgetPeriods
      .filter((period) => period.base_budget_id === budget.id)
      .map((period) => `${period.period_start} ${period.period_end} ${formatMinorUnits(period.overall_limit, budget.currency)}`)
    const limits = figures.map((figure) => (
      `${figure.month}-01 ${getMonthEnd(figure.month)} ${toCurrency(figure.amount, manifest.budgetDecimals, currency)}`
    ))
    for (const limit of limits.filter((entry) => !periods.includes(entry))) {
      differences.add('budget-period-missing', `${category.label} ${limit}`, limit, 'absent')
    }
    for (const period of periods.filter((entry) => !limits.includes(entry))) {
      differences.add('budget-period-extra', `${category.label} ${period}`, 'absent', period)
    }
  }

  for (const budget of lumina.baseBudgets.filter((entry) => !paired.has(entry.id))) {
    differences.add('budget-extra', budget.name, 'absent', 'present')
  }
}

// The manifest names an account rather than giving its id wherever it describes a row
function findLuminaAccountId(manifest: ActualManifest, mappings: ImportMappings, name: string) {
  return mappings.accounts.get(manifest.accounts.find((account) => account.name === name)?.id ?? '')
}

function requireCategory(categoryById: Map<string, ManifestCategory>, categoryId: string) {
  const category = categoryById.get(categoryId)
  if (!category) throw new Error(`The manifest records no category ${categoryId}`)
  return category
}

/**
 * Writes an amount Actual stored at one scale in the decimal places Lumina keeps for a currency,
 * marking one that currency can't hold rather than rounding it
 */
function toCurrency(amount: string, decimals: number, currency: string) {
  const exponent = requireExponent(currency)
  const units = readStored(amount, decimals)
  if (exponent >= decimals) return formatStored(units * 10n ** BigInt(exponent - decimals), exponent)
  const divisor = 10n ** BigInt(decimals - exponent)
  return units % divisor === 0n ? formatStored(units / divisor, exponent) : `${amount} (more precise than ${currency})`
}

function negate(amount: string) {
  return formatStored(-readStored(amount, ACTUAL_TRANSACTION_DECIMALS), ACTUAL_TRANSACTION_DECIMALS)
}

// Lumina can hold an amount in a currency the dataset never uses, which is itself a difference, so
// it is shown as it is stored rather than stopping the comparison
function formatMinorUnits(minorUnits: number, currency: string) {
  if (!(currency in CURRENCY_EXPONENTS)) return `${minorUnits} minor units of ${currency}`
  return formatStored(minorUnits, CURRENCY_EXPONENTS[currency])
}

function requireExponent(currency: string) {
  const exponent = CURRENCY_EXPONENTS[currency]
  if (exponent === undefined) throw new Error(`No decimal places recorded for ${currency}`)
  return exponent
}

/** Keeps one difference per kind, subject and Lumina value, counting repeats */
class DifferenceList {
  private readonly entries = new Map<string, Difference & { count: number }>()

  add(kind: string, subject: string, actual: string, lumina: string) {
    const key = JSON.stringify([kind, subject, lumina])
    const entry = this.entries.get(key)
    if (entry) {
      entry.count += 1
    } else {
      this.entries.set(key, { kind, subject, actual, lumina, count: 1 })
    }
  }

  list(): Difference[] {
    return [...this.entries.values()].map(({ count, ...difference }) => (
      count > 1 ? { ...difference, actual: `${difference.actual} (${count} times)` } : difference
    ))
  }
}
