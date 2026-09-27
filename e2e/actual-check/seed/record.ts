/**
 * Writes one budget's manifest from Actual's own API, never from the export the importer reads
 *
 * The one exception is the budget figures. Actual has no API that reads back what a month was
 * budgeted reliably, so the figures are the ones the seed set, and the seed stops unless the
 * export's own table of the budget type that is on holds exactly those
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { unzipSync } from 'fflate'
import {
  ACTUAL_TRANSACTION_DECIMALS,
  compareText,
  formatStored,
  type ActualManifest,
  type ManifestCategory,
  type ManifestCategoryMonth,
  type ManifestRow,
  type ManifestTransfer,
} from '../manifest.ts'
import type { api as ActualApi } from './actual.ts'
import type { SeededFigures, SeedFigure } from './dataset.ts'

type Api = typeof ActualApi

// Wide enough to take in every row the dataset writes, the one dated tomorrow included
const LIST_RANGE = ['2000-01-01', '2100-12-31'] as const

interface RecordOptions {
  budget: string
  asOf: string
  exportZip: Uint8Array
  seeded: SeededFigures

  /** Decimal places Actual's own currency table gives each currency */
  currencyDecimals: Map<string, number>
}

export async function recordManifest(api: Api, options: RecordOptions): Promise<ActualManifest> {
  const { budget, asOf, exportZip, seeded, currencyDecimals } = options
  const preferences = await api.getPreferences() as Record<string, unknown>
  const budgetType = preferences.budgetType === 'tracking' ? 'tracking' : 'envelope'
  const currency = String(preferences['flags.currency']) === 'true' && preferences.defaultCurrencyCode
    ? String(preferences.defaultCurrencyCode)
    : null
  const budgetDecimals = currency ? currencyDecimals.get(currency) ?? 2 : 2

  const exported = await readExport(exportZip)
  try {
    checkBudgetTable(exported, budgetType === 'tracking' ? 'reflect_budgets' : 'zero_budgets', seeded.figures, 'set')
    checkBudgetTable(exported, budgetType === 'tracking' ? 'zero_budgets' : 'reflect_budgets', seeded.leftovers, 'left behind')
  } finally {
    exported.close()
  }

  const accounts = await api.getAccounts()
  const accountById = new Map(accounts.map((account) => [account.id, account]))
  const groups = await api.getCategoryGroups()
  const categories = buildCategories(await api.getCategories(), groups)
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const payees = await api.getPayees()
  const payeeById = new Map(payees.map((payee) => [payee.id, payee]))

  // A deleted category reads as none, the way Actual's screens show a row filed under one
  const liveCategory = (id: string | null | undefined) => (id && categoryById.has(id) ? id : null)
  const describe = (row: Part, accountName: string): ManifestRow => ({
    date: row.date,
    account: accountName,
    amount: formatStored(row.amount, ACTUAL_TRANSACTION_DECIMALS),
    payee: payeeById.get(row.payee ?? '')?.name ?? null,
    category: categoryById.get(row.category ?? '')?.name ?? null,
    notes: row.notes ?? null,
  })

  const counted: (Part & { account: string; offBudget: boolean })[] = []
  const afterAsOf: ManifestRow[] = []
  const unbalancedSplits: ManifestRow[] = []
  const transfers: ManifestTransfer[] = []
  const transactionById = new Map<string, Part>()
  const balances = new Map<string, bigint>()

  for (const account of accounts) {
    const parts: Part[] = []
    for (const transaction of await api.getTransactions(account.id, ...LIST_RANGE) as Transaction[]) {
      const children = transaction.subtransactions ?? []
      if (children.length > 0) {
        const partsTotal = children.reduce((total, child) => total + child.amount, 0)
        if (partsTotal !== transaction.amount) unbalancedSplits.push(describe(transaction, account.name))
      }

      // A split stands for its parts, each carrying the split's payee and date when it has none
      const rows = children.length > 0
        ? children.map((child) => ({ ...child, date: transaction.date, payee: child.payee ?? transaction.payee }))
        : [transaction]
      for (const row of rows) {
        parts.push(row)
        transactionById.set(row.id, row)
      }
    }

    for (const part of parts) {
      if (part.date > asOf) {
        afterAsOf.push(describe(part, account.name))
        continue
      }
      balances.set(account.id, (balances.get(account.id) ?? 0n) + BigInt(part.amount))
      counted.push({ ...part, account: account.id, offBudget: Boolean(account.offbudget) })
    }

    // Actual's own balance has to be what its rows add up to, or every balance difference would be Actual's
    const actualBalance = await api.getAccountBalance(account.id, new Date(`${asOf}T12:00:00`))
    if (BigInt(actualBalance) !== (balances.get(account.id) ?? 0n)) {
      throw new Error(`Actual reports ${account.name} at ${actualBalance}, but its rows add up to ${balances.get(account.id) ?? 0n}`)
    }
  }

  // A row whose payee stands for another account is a transfer, listed once from the side money
  // leaves, or for one that moves nothing, from the side with the lower id
  for (const row of counted) {
    const counterpartAccount = payeeById.get(row.payee ?? '')?.transfer_acct
    const counterpart = row.transfer_id ? transactionById.get(row.transfer_id) : undefined
    const isListedSide = row.amount < 0 || (row.amount === 0 && (!counterpart || row.id < counterpart.id))
    if (!counterpartAccount || !isListedSide) continue
    transfers.push({
      date: row.date,
      account: accountById.get(row.account)?.name ?? row.account,
      counterpartAccount: accountById.get(counterpartAccount)?.name ?? counterpartAccount,
      amount: formatStored(-row.amount, ACTUAL_TRANSACTION_DECIMALS),
      category: categoryById.get(liveCategory(row.category) ?? '')?.name ?? null,
      linkedBothWays: counterpart?.transfer_id === row.id,
    })
  }

  const monthTotals = new Map<string, bigint>()
  for (const row of counted) {
    const categoryId = liveCategory(row.category)
    if (row.offBudget || !categoryId) continue
    const key = JSON.stringify([categoryId, row.date.slice(0, 7)])
    monthTotals.set(key, (monthTotals.get(key) ?? 0n) + BigInt(row.amount))
  }
  const categoryMonths: ManifestCategoryMonth[] = [...monthTotals]
    .map(([key, total]) => {
      const [categoryId, month] = JSON.parse(key) as [string, string]
      return { categoryId, month, total: formatStored(total, ACTUAL_TRANSACTION_DECIMALS) }
    })
    .sort((a, b) => compareText(a.categoryId, b.categoryId) || compareText(a.month, b.month))

  return {
    budget,
    asOf,
    budgetType,
    currency,
    budgetDecimals,
    databaseVersion: exported.databaseVersion,
    accounts: accounts
      .map((account) => ({
        id: account.id,
        name: account.name,
        offBudget: Boolean(account.offbudget),
        closed: Boolean(account.closed),
        balance: formatStored(balances.get(account.id) ?? 0n, ACTUAL_TRANSACTION_DECIMALS),
      }))
      .sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id)),
    categories,
    categoryMonths,
    figures: seeded.figures
      .map((figure) => ({ ...figure, amount: formatStored(figure.amount, budgetDecimals) }))
      .sort((a, b) => compareText(a.categoryId, b.categoryId) || compareText(a.month, b.month)),
    transfers: transfers.sort((a, b) => compareText(a.date, b.date) || compareText(a.account, b.account)),
    afterAsOf: afterAsOf.sort(compareRows),
    unbalancedSplits: unbalancedSplits.sort(compareRows),
  }
}

/**
 * Cross-checks the declared figures against Actual's month report, printing what disagrees
 *
 * Only printed, never failed on, since the report is known to part from the stored figures: it
 * returned 0 for a month whose table held 116, it throws for a month outside `getBudgetMonths()`,
 * and its spent figures take in rows dated later in the current month
 */
export async function crossCheckBudgetMonths(api: Api, budget: string, figures: SeedFigure[]) {
  const months = new Set(await api.getBudgetMonths())
  const mismatches: string[] = []
  for (const month of [...new Set(figures.map((figure) => figure.month))].sort()) {
    if (!months.has(month)) {
      mismatches.push(`${month} is outside the months Actual reports`)
      continue
    }
    const report = await api.getBudgetMonth(month)
    const budgeted = new Map(report.categoryGroups.flatMap((group) => (group.categories ?? []).map((category) => [category.id, category.budgeted])))
    for (const figure of figures.filter((entry) => entry.month === month)) {
      const reported = budgeted.get(figure.categoryId) ?? 0
      if (reported !== figure.amount) mismatches.push(`${month} ${figure.categoryId}: set ${figure.amount}, reported ${reported}`)
    }
  }
  if (mismatches.length > 0) console.log(`Actual's month report parts from the ${budget} figures: ${mismatches.join('; ')}`)
}

interface Part {
  id: string
  date: string
  amount: number
  payee?: string | null
  category?: string | null
  notes?: string | null
  transfer_id?: string | null
}

interface Transaction extends Part {
  subtransactions?: Part[]
}

interface ExportedDatabase {
  databaseVersion: number | null
  rows: (sql: string) => Record<string, unknown>[]
  close: () => void
}

/** Opens the db.sqlite inside an export zip, read-only, from a copy in a temporary folder */
async function readExport(zip: Uint8Array): Promise<ExportedDatabase> {
  const entries = unzipSync(zip)
  const name = Object.keys(entries).find((entry) => entry.split('/').pop() === 'db.sqlite')
  if (!name) throw new Error('The export holds no db.sqlite')
  const dir = await mkdtemp(join(tmpdir(), 'actual-export-'))
  const path = join(dir, 'db.sqlite')
  await writeFile(path, entries[name])
  const database = new DatabaseSync(path, { readOnly: true })
  const rows = (sql: string) => database.prepare(sql).all() as Record<string, unknown>[]
  const [latest] = rows('SELECT MAX(id) AS id FROM __migrations__')
  return {
    databaseVersion: typeof latest?.id === 'number' ? latest.id : null,
    rows,
    close: () => {
      database.close()
      void rm(dir, { recursive: true, force: true })
    },
  }
}

/**
 * Stops the seed unless one of the export's budget tables holds exactly the given figures. A zero
 * is no figure, since Actual writes those as it opens months, and Actual copies a carryover on to
 * every later month, so a declared carryover only has to be among the stored ones
 */
function checkBudgetTable(exported: ExportedDatabase, table: string, expected: SeedFigure[], verb: string) {
  const stored = exported.rows(`SELECT month, category, amount, carryover FROM ${table} WHERE amount <> 0 OR carryover = 1`)
    .map((row) => ({
      month: `${String(row.month).slice(0, 4)}-${String(row.month).slice(4)}`,
      categoryId: String(row.category),
      amount: Number(row.amount),
      carryover: Number(row.carryover) === 1,
    }))
  const describe = (figure: SeedFigure) => `${figure.month} ${figure.categoryId} ${figure.amount}`
  const storedAmounts = stored.filter((figure) => figure.amount !== 0).map(describe)
  const declaredAmounts = expected.map(describe)
  const storedCarryovers = new Set(stored.filter((figure) => figure.carryover).map((figure) => `${figure.month} ${figure.categoryId}`))

  const missing = [
    ...declaredAmounts.filter((entry) => !storedAmounts.includes(entry)),
    ...expected
      .filter((figure) => figure.carryover && !storedCarryovers.has(`${figure.month} ${figure.categoryId}`))
      .map((figure) => `${figure.month} ${figure.categoryId} carried over`),
  ]
  const extra = storedAmounts.filter((entry) => !declaredAmounts.includes(entry))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`The export's ${table} doesn't hold the figures the seed ${verb}. Missing: ${missing.join('; ') || 'none'}. Unexpected: ${extra.join('; ') || 'none'}`)
  }
}

function buildCategories(
  categories: { id: string; name: string; group_id: string; is_income?: boolean; hidden?: boolean }[],
  groups: { id: string; name: string; hidden?: boolean }[],
): ManifestCategory[] {
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const nameCounts = new Map<string, number>()
  for (const category of categories) nameCounts.set(category.name.toLowerCase(), (nameCounts.get(category.name.toLowerCase()) ?? 0) + 1)
  return categories
    .map((category) => {
      const group = groupById.get(category.group_id)
      const isShared = (nameCounts.get(category.name.toLowerCase()) ?? 0) > 1
      return {
        id: category.id,
        name: category.name,
        label: isShared && group ? `${category.name} (${group.name})` : category.name,
        group: group?.name ?? '',
        isIncome: Boolean(category.is_income),
        hidden: Boolean(category.hidden) || Boolean(group?.hidden),
      }
    })
    .sort((a, b) => compareText(a.label, b.label) || compareText(a.id, b.id))
}

function compareRows(a: ManifestRow, b: ManifestRow) {
  return compareText(a.date, b.date) || compareText(a.account, b.account) || compareText(a.amount, b.amount)
}
