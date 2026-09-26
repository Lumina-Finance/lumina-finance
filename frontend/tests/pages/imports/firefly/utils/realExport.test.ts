/**
 * A whole export from a seeded Firefly III, committed with what Firefly III's own API reported
 * for the same data, so a change in how an export is read shows up without a Firefly III instance
 *
 * The files come from one run of the Firefly III import check. To refresh them, run
 * e2e/firefly-check/seed.sh, then `make e2e-test ARGS="-c firefly-check/playwright.config.ts"`,
 * and copy transactions.csv, budgets.csv, accounts.csv, manifest.json and run.json from
 * e2e/firefly-check/output to fixtures/real-export, and the run's upload-fixture.json from
 * e2e/test-results to backend/tests/fixtures/firefly/real-export-upload.json. Both come from the
 * same run, which the payload test below checks
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import { buildFireflyStageBatches, type FireflyImportRunBudgets, type FireflyImportStageBatch } from '@/api/firefly-imports'
import {
  buildFireflyBudgetDrafts,
  buildFireflyRunBudgets,
  forecastFireflyImport,
  readFireflyCsvFile,
  resolveFireflyRowLegs,
} from '@/pages/imports/firefly/utils'
import type { FireflyFileKind } from '@/pages/imports/firefly/types'
import { stageFireflyImportAsNew } from './fixtures'

// The parts of e2e/firefly-check/manifest.ts this test reads
interface Endpoint {
  name: string
  imported: boolean
}

interface Manifest {
  accounts: { name: string; type: string; balance: string; currency: string }[]
  accountMonths: { account: string; accountType: string; month: string; count: number; total: string }[]
  categoryMonths: { category: string; month: string; currency: string; total: string }[]
  rows: { date: string; type: string; source: Endpoint; destination: Endpoint; category: string; budget: string }[]
  budgets: { name: string; active: boolean; limits: { start: string; end: string; amount: string; currency: string }[] }[]
}

const CURRENCIES: Currency[] = [
  { id: 'EUR', name: 'Euro', symbol: '€', minor_unit_exponent: 2 },
  { id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
]

const readFixture = (name: string) => readFileSync(new URL(`../fixtures/real-export/${name}`, import.meta.url), 'utf8')

// What the import screen sent for this export in the same run, which the backend test replays
const capturedUpload = JSON.parse(readFileSync(
  new URL('../../../../../../backend/tests/fixtures/firefly/real-export-upload.json', import.meta.url),
  'utf8',
)) as { transactions: FireflyImportStageBatch[]; budgets: FireflyImportRunBudgets | null; archive: string[] | null }
const manifest = JSON.parse(readFixture('manifest.json')) as Manifest
const { fireflyVersion } = JSON.parse(readFixture('run.json')) as { fireflyVersion: string }

const readExport = (name: string, kind: FireflyFileKind) => readFireflyCsvFile(
  new File([readFixture(name)], name),
  kind,
  new Set(CURRENCIES.map((currency) => currency.id)),
)

/** Writes minor units the way the manifest writes amounts */
function formatMinorUnits(minorUnits: number, currency: string) {
  const exponent = CURRENCIES.find((entry) => entry.id === currency)!.minor_unit_exponent
  const sign = minorUnits < 0 ? '-' : ''
  const digits = String(Math.abs(minorUnits)).padStart(exponent + 1, '0')
  return exponent === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`
}

/** Tells an account apart from another of the same name, as the manifest does */
function getAccountKey(name: string, type: string) {
  return JSON.stringify([name, type])
}

/** A withdrawal from, or deposit into, an imported account whose other side is outside */
function isPayeeRow(row: Manifest['rows'][number]) {
  return (row.type === 'withdrawal' && row.source.imported && !row.destination.imported)
    || (row.type === 'deposit' && row.destination.imported && !row.source.imported)
}

describe(`a real Firefly III ${fireflyVersion} export`, () => {
  it('resolves every row to the balances and monthly totals Firefly III reports', async () => {
    const draft = await readExport('transactions.csv', 'transactions')
    const { options } = stageFireflyImportAsNew(draft, draft.rows, CURRENCIES)

    expect(forecastFireflyImport(draft.rows, { fileId: draft.id, ...options }).skippedRows).toEqual([])

    // An account with no transactions, which only the accounts export lists, stays at zero
    const balances = new Map(manifest.accounts.map((account) => [getAccountKey(account.name, account.type), 0]))
    const accountMonths = new Map<string, { count: number; total: number }>()
    const categoryMonths = new Map<string, number>()
    for (const row of draft.rows) {
      const { legs, skipReason } = resolveFireflyRowLegs(row, options)
      expect(skipReason).toBeNull()

      // A row between two imported accounts gives two legs, source first, and any other row one
      // leg on its one imported side, so each leg is told apart from a namesake by its side
      const sides = [
        options.accountSources.find(row.source_name, row.source_type),
        options.accountSources.find(row.destination_name, row.destination_type),
      ].filter((side) => side !== null)
      expect(sides).toHaveLength(legs!.length)

      for (const [index, leg] of legs!.entries()) {
        const account = getAccountKey(sides[index].name, sides[index].type)
        const { currency } = leg.account
        const month = row.date!.slice(0, 7)
        balances.set(account, (balances.get(account) ?? 0) + leg.amount)
        const accountMonth = accountMonths.get(JSON.stringify([account, month])) ?? { count: 0, total: 0 }
        accountMonth.count += 1
        accountMonth.total += leg.amount
        accountMonths.set(JSON.stringify([account, month]), accountMonth)

        // Only a payee leg is written with the row's category. Transfer and balance legs take a
        // system category, which this staging leaves unset
        if (!leg.category) continue
        const key = `${row.category?.trim() ?? ''} ${month} ${currency}`
        categoryMonths.set(key, (categoryMonths.get(key) ?? 0) + leg.amount)
      }
    }

    const currencyByAccount = new Map(manifest.accounts.map((account) => [getAccountKey(account.name, account.type), account.currency]))
    expect(Object.fromEntries([...balances].map(([account, total]) => [account, formatMinorUnits(total, currencyByAccount.get(account)!)])))
      .toEqual(Object.fromEntries(manifest.accounts.map((account) => [getAccountKey(account.name, account.type), account.balance])))
    expect(Object.fromEntries([...accountMonths].map(([key, { count, total }]) => {
      const [account] = JSON.parse(key) as [string, string]
      return [key, `${count} ${formatMinorUnits(total, currencyByAccount.get(account)!)}`]
    }))).toEqual(Object.fromEntries(manifest.accountMonths.map((month) => [
      JSON.stringify([getAccountKey(month.account, month.accountType), month.month]),
      `${month.count} ${month.total}`,
    ])))
    expect(Object.fromEntries([...categoryMonths].map(([key, total]) => [key, formatMinorUnits(total, key.slice(-3))])))
      .toEqual(Object.fromEntries(manifest.categoryMonths.map((month) => [
        `${month.category} ${month.month} ${month.currency}`,
        month.total,
      ])))
  })

  // A new user's import creates every account, so staging everything as new sends what the screen
  // sent, and a change in how rows are unescaped, signed, paired or batched shows up here
  it('stages the batches, budgets and accounts to archive the import screen sent for this export', async () => {
    const [transactions, budgetsFile, accounts] = await Promise.all([
      readExport('transactions.csv', 'transactions'),
      readExport('budgets.csv', 'budgets'),
      readExport('accounts.csv', 'accounts'),
    ])
    const { options, payload, archiveAccountSources } = stageFireflyImportAsNew(
      transactions,
      transactions.rows,
      CURRENCIES,
      accounts.rows,
    )
    const batches = await buildFireflyStageBatches(payload)
    expect(archiveAccountSources).toEqual(capturedUpload.archive ?? [])

    expect(batches).toHaveLength(capturedUpload.transactions.length)
    for (const [index, batch] of batches.entries()) {
      const captured = capturedUpload.transactions[index]
      expect(batch.start_row_index).toBe(captured.start_row_index)
      // The screen lists accounts in the order its rows first use them
      expect(batch.accounts).toEqual(expect.arrayContaining(captured.accounts))
      expect(batch.accounts).toHaveLength(captured.accounts.length)
      expect(batch.rows).toEqual(captured.rows)
    }

    // Every budget the export can import is selected unless the user clears it
    const drafts = buildFireflyBudgetDrafts({
      budgetsFile,
      transactionRows: transactions.rows,
      currencies: CURRENCIES,
      categoryMappings: options.categoryMappings,
      categoryById: new Map(),
    }).filter((draft) => draft.disabledReason === null)
    const runBudgets = buildFireflyRunBudgets(drafts, payload.categories)
    expect(runBudgets.budgets).toEqual(capturedUpload.budgets?.budgets)
    // The captured mappings name an existing category rather than its id, so only the sources compare
    expect(runBudgets.categories.map((mapping) => mapping.source))
      .toEqual(capturedUpload.budgets?.categories.map((mapping) => mapping.source))
  })

  it('reads every budget with the limits and categories Firefly III holds for it', async () => {
    const [transactions, budgets] = await Promise.all([
      readExport('transactions.csv', 'transactions'),
      readExport('budgets.csv', 'budgets'),
    ])
    const { options } = stageFireflyImportAsNew(transactions, transactions.rows, CURRENCIES)
    const drafts = buildFireflyBudgetDrafts({
      budgetsFile: budgets,
      transactionRows: transactions.rows,
      currencies: CURRENCIES,
      categoryMappings: options.categoryMappings,
      categoryById: new Map(),
    })

    // Limits are compared as numbers, since the export writes twelve decimal places
    const describeLimits = (limits: { start: string; end: string; amount: string }[]) => limits
      .map((limit) => `${limit.start} ${limit.end} ${Number(limit.amount)}`)
      .sort()

    expect(drafts.map((draft) => ({
      name: draft.name,
      isArchived: draft.isArchived,
      disabledReason: draft.disabledReason,
      currency: draft.currencyCode,
      categories: [...draft.categoryNames].sort(),
      limits: describeLimits(draft.limits),
    }))).toEqual(manifest.budgets.map((budget) => ({
      name: budget.name,
      isArchived: !budget.active,
      disabledReason: null,
      currency: budget.limits[0].currency,
      categories: [...new Set(manifest.rows
        .filter((row) => row.budget === budget.name && row.category && isPayeeRow(row))
        .map((row) => row.category))].sort(),
      limits: describeLimits(budget.limits),
    })))
  })
})
