/**
 * Writes the manifest from Firefly III's own API, never from its export files
 */
import {
  getAccountKey,
  type FireflyManifest,
  type ManifestAccount,
  type ManifestAccountMonth,
  type ManifestBudget,
  type ManifestCategoryMonth,
  type ManifestEndpoint,
  type ManifestRow,
} from '../manifest.ts'
import { AS_OF, CURRENCY_EXPONENTS, DATASET_START } from './dataset.ts'
import type {
  FireflyAccountAttributes,
  FireflyBudgetAttributes,
  FireflyBudgetLimitAttributes,
  FireflyClient,
  FireflyResource,
  FireflySplit,
  FireflyTransactionGroupAttributes,
} from './firefly.ts'

/** Firefly III's names for the account types Lumina imports */
const IMPORTED_ACCOUNT_TYPES = new Set(['asset account', 'loan', 'debt', 'mortgage'])

// The type Firefly III's rows and accounts export give an asset account and each liability type,
// which the API reports apart as the account's type and its liability type
const ROW_TYPE_BY_ACCOUNT_TYPE: Record<string, string> = {
  asset: 'Asset account',
  loan: 'Loan',
  debt: 'Debt',
  mortgage: 'Mortgage',
}

// Far enough ahead to take in the future-dated row, which the manifest lists but counts nowhere
const LIST_END = '2099-12-31'

export async function recordManifest(firefly: FireflyClient): Promise<FireflyManifest> {
  const accountResources = [
    ...await firefly.list<FireflyResource<FireflyAccountAttributes>>(`/accounts?type=asset&date=${AS_OF}`),
    ...await firefly.list<FireflyResource<FireflyAccountAttributes>>(`/accounts?type=liabilities&date=${AS_OF}`),
  ]
  const currencyByAccount = new Map(accountResources.map(({ attributes }) => [
    getAccountKey(attributes.name, getRowType(attributes)),
    attributes.currency_code,
  ]))

  const groups = await firefly.list<FireflyResource<FireflyTransactionGroupAttributes>>(
    `/transactions?type=all&start=${DATASET_START}&end=${LIST_END}`,
  )
  const rows = groups
    .flatMap(({ attributes }) => attributes.transactions.map((split) => buildRow(split, attributes.group_title, currencyByAccount)))
    .sort(compareRows)
  const countedRows = rows.filter((row) => !row.afterAsOf)

  return {
    asOf: AS_OF,
    exportStart: DATASET_START,
    accounts: buildAccounts(accountResources, countedRows),
    accountMonths: buildAccountMonths(countedRows, currencyByAccount),
    categoryMonths: buildCategoryMonths(countedRows, currencyByAccount),
    rows,
    budgets: await buildBudgets(firefly),
  }
}

function buildRow(split: FireflySplit, groupTitle: string | null, currencyByAccount: Map<string, string>): ManifestRow {
  const date = split.date.slice(0, 10)
  return {
    date,
    type: split.type,
    description: split.description,
    groupTitle: groupTitle ?? '',
    source: buildEndpoint(split, 'source', currencyByAccount),
    destination: buildEndpoint(split, 'destination', currencyByAccount),
    category: split.category_name ?? '',
    budget: split.budget_name ?? '',
    tags: [...split.tags].sort(),
    notes: split.notes ?? '',
    foreign: getForeignAmount(split, currencyByAccount),
    afterAsOf: date > AS_OF,
  }
}

/**
 * Reads one side of a split, with the amount it moves in its own account's currency
 *
 * Firefly III states a split in one currency and, where a second is involved, a foreign amount, so
 * each imported side takes whichever of the two is in its account's currency
 */
function buildEndpoint(
  split: FireflySplit,
  side: 'source' | 'destination',
  currencyByAccount: Map<string, string>,
): ManifestEndpoint {
  const name = side === 'source' ? split.source_name : split.destination_name
  const type = side === 'source' ? split.source_type : split.destination_type
  const imported = IMPORTED_ACCOUNT_TYPES.has(type.toLowerCase())
  if (!imported) return { name, type, imported, amount: null }

  const currency = getCurrency(currencyByAccount, getAccountKey(name, type))
  const amount = split.currency_code === currency
    ? split.amount
    : split.foreign_currency_code === currency ? split.foreign_amount : null
  if (amount === null) throw new Error(`No amount in ${currency} for ${name} on "${split.description}"`)

  const minorUnits = toMinorUnits(amount, currency)
  return { name, type, imported, amount: formatMinorUnits(side === 'source' ? -minorUnits : minorUnits, currency) }
}

/**
 * Finds the amount a split states in a currency that none of its imported sides is kept in, which
 * is the price paid abroad on a row from an account in another currency
 */
function getForeignAmount(split: FireflySplit, currencyByAccount: Map<string, string>) {
  const kept = new Set([
    currencyByAccount.get(getAccountKey(split.source_name, split.source_type)),
    currencyByAccount.get(getAccountKey(split.destination_name, split.destination_type)),
  ].filter(Boolean))
  const stated: [string | null, string | null][] = [[split.amount, split.currency_code], [split.foreign_amount, split.foreign_currency_code]]
  for (const [amount, currency] of stated) {
    if (!amount || !currency || kept.has(currency)) continue
    const minorUnits = toMinorUnits(amount, currency)
    return { amount: formatMinorUnits(minorUnits < 0n ? -minorUnits : minorUnits, currency), currency }
  }
  return null
}

function buildAccounts(resources: FireflyResource<FireflyAccountAttributes>[], rows: ManifestRow[]): ManifestAccount[] {
  return resources
    .map(({ attributes }) => {
      const currency = attributes.currency_code
      const type = getRowType(attributes)
      let rowTotal = 0n
      for (const { endpoint } of importedEndpoints(rows)) {
        if (endpoint.name === attributes.name && endpoint.type === type) rowTotal += toMinorUnits(endpoint.amount ?? '0', currency)
      }
      return {
        name: attributes.name,
        type,
        role: attributes.type === 'liabilities' ? attributes.liability_type ?? '' : attributes.account_role ?? '',
        liabilityDirection: attributes.liability_direction,
        currency,
        active: attributes.active,
        balance: formatMinorUnits(toMinorUnits(attributes.current_balance, currency), currency),
        rowTotal: formatMinorUnits(rowTotal, currency),
      }
    })
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.type, b.type))
}

function buildAccountMonths(rows: ManifestRow[], currencyByAccount: Map<string, string>): ManifestAccountMonth[] {
  const totals = new Map<string, { account: string; accountType: string; month: string; count: number; minorUnits: bigint }>()
  for (const { row, endpoint } of importedEndpoints(rows)) {
    const month = row.date.slice(0, 7)
    const key = JSON.stringify([endpoint.name, endpoint.type, month])
    const entry = totals.get(key) ?? { account: endpoint.name, accountType: endpoint.type, month, count: 0, minorUnits: 0n }
    entry.count += 1
    entry.minorUnits += toMinorUnits(endpoint.amount ?? '0', getCurrency(currencyByAccount, getAccountKey(endpoint.name, endpoint.type)))
    totals.set(key, entry)
  }
  return [...totals.values()]
    .map(({ account, accountType, month, count, minorUnits }) => ({
      account,
      accountType,
      month,
      count,
      total: formatMinorUnits(minorUnits, getCurrency(currencyByAccount, getAccountKey(account, accountType))),
    }))
    .sort((a, b) => compareText(a.account, b.account) || compareText(a.accountType, b.accountType) || compareText(a.month, b.month))
}

/**
 * Totals the rows between an imported account and one outside the import, the only rows Lumina
 * writes with a category of their own, by category, month and account currency
 */
function buildCategoryMonths(rows: ManifestRow[], currencyByAccount: Map<string, string>): ManifestCategoryMonth[] {
  const totals = new Map<string, ManifestCategoryMonth & { minorUnits: bigint }>()
  for (const row of rows) {
    const payeeSide = getPayeeSide(row)
    if (!payeeSide) continue

    const currency = getCurrency(currencyByAccount, getAccountKey(payeeSide.name, payeeSide.type))
    const month = row.date.slice(0, 7)
    const key = JSON.stringify([row.category, month, currency])
    const entry = totals.get(key) ?? { category: row.category, month, currency, total: '', minorUnits: 0n }
    entry.minorUnits += toMinorUnits(payeeSide.amount ?? '0', currency)
    totals.set(key, entry)
  }
  return [...totals.values()]
    .map(({ minorUnits, ...entry }) => ({ ...entry, total: formatMinorUnits(minorUnits, entry.currency) }))
    .sort((a, b) => compareText(a.category, b.category) || compareText(a.month, b.month) || compareText(a.currency, b.currency))
}

async function buildBudgets(firefly: FireflyClient): Promise<ManifestBudget[]> {
  const budgets = await firefly.list<FireflyResource<FireflyBudgetAttributes>>('/budgets')
  const result: ManifestBudget[] = []
  for (const budget of budgets) {
    const limits = await firefly.list<FireflyResource<FireflyBudgetLimitAttributes>>(
      `/budgets/${budget.id}/limits?start=${DATASET_START}&end=${AS_OF}`,
    )
    result.push({
      name: budget.attributes.name,
      active: budget.attributes.active,
      limits: limits
        .map(({ attributes }) => ({
          start: attributes.start.slice(0, 10),
          end: attributes.end.slice(0, 10),
          amount: formatMinorUnits(toMinorUnits(attributes.amount, attributes.currency_code), attributes.currency_code),
          currency: attributes.currency_code,
        }))
        .sort((a, b) => compareText(a.start, b.start)),
    })
  }
  return result.sort((a, b) => compareText(a.name, b.name))
}

/** The imported side of a withdrawal from, or deposit into, an imported account, with the other side outside */
function getPayeeSide(row: ManifestRow): ManifestEndpoint | null {
  if (row.type === 'withdrawal' && row.source.imported && !row.destination.imported) return row.source
  if (row.type === 'deposit' && row.destination.imported && !row.source.imported) return row.destination
  return null
}

function* importedEndpoints(rows: ManifestRow[]) {
  for (const row of rows) {
    for (const endpoint of [row.source, row.destination]) {
      if (endpoint.imported) yield { row, endpoint }
    }
  }
}

function getCurrency(currencyByAccount: Map<string, string>, accountKey: string) {
  const currency = currencyByAccount.get(accountKey)
  if (!currency) throw new Error(`No currency recorded for ${accountKey}`)
  return currency
}

function getRowType(attributes: FireflyAccountAttributes) {
  const accountType = attributes.type === 'liabilities' ? attributes.liability_type ?? '' : attributes.type
  const type = ROW_TYPE_BY_ACCOUNT_TYPE[accountType]
  if (!type) throw new Error(`No row type recorded for the Firefly III account type "${accountType}" of ${attributes.name}`)
  return type
}

/** Reads Firefly III decimal text into whole minor units of a currency, refusing lost precision */
export function toMinorUnits(amount: string, currency: string): bigint {
  const exponent = CURRENCY_EXPONENTS[currency]
  if (exponent === undefined) throw new Error(`No decimal places recorded for ${currency}`)

  const match = amount.trim().match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if (!match) throw new Error(`Unreadable amount "${amount}"`)
  const [, sign, whole, fraction = ''] = match
  if (/[1-9]/.test(fraction.slice(exponent))) throw new Error(`Amount "${amount}" is more precise than ${currency}`)

  const units = BigInt(whole + fraction.slice(0, exponent).padEnd(exponent, '0'))
  return sign ? -units : units
}

export function formatMinorUnits(minorUnits: bigint, currency: string): string {
  const exponent = CURRENCY_EXPONENTS[currency]
  if (exponent === undefined) throw new Error(`No decimal places recorded for ${currency}`)
  const sign = minorUnits < 0n ? '-' : ''
  const digits = (minorUnits < 0n ? -minorUnits : minorUnits).toString().padStart(exponent + 1, '0')
  return exponent === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`
}

function compareRows(a: ManifestRow, b: ManifestRow) {
  return compareText(a.date, b.date)
    || compareText(a.description, b.description)
    || compareText(a.source.name, b.source.name)
    || compareText(a.destination.name, b.destination.name)
    || compareText(a.source.amount ?? a.destination.amount ?? '', b.source.amount ?? b.destination.amount ?? '')
}

/** Orders by code point, so the manifest reads the same whatever locale the seed runs in */
function compareText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0
}
