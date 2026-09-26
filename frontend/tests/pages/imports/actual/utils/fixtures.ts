/**
 * The Actual Budget exports under ../fixtures, each written by a local Actual 26.9 server and
 * committed with a manifest of what that server reported for the same data as of one date
 *
 * The envelope budget has the currency feature off. The yen budget has it on with JPY, and its
 * opening balance, one transaction and every budget figure were typed through Actual's own screens.
 * Transactions and balances in the manifests come from Actual's API. Budget figures come from the
 * table of the budget type switched on, since the API's monthly budget report dropped every figure
 * of one month and kept one from before a budget type switch, where Actual's budget screen showed
 * the stored figures
 *
 * The edges budget holds the shapes the other two leave out: accounts deleted after transfers to
 * them, a split child that is a transfer, a split edited until it no longer adds up, a zero
 * transfer, a closed account with money left, a category merged into one later deleted, a hidden
 * category group, two categories sharing a name in different groups, and one category used both on
 * spending and on payments to an off-budget loan. Its manifest names each category's group
 */
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import initSqlJs from 'sql.js'
import type { ActualBudgetFile, ActualTransaction } from '@/pages/imports/actual/types'
import { normaliseActualBudget } from '@/pages/imports/actual/utils/normalise'
import { readActualBudgetFile } from '@/pages/imports/actual/utils/readFile'

export type ActualFixtureBudget = 'envelope' | 'yen' | 'edges'

export interface ActualManifestRow {
  account: string
  offBudget: boolean
  date: string
  amount: string
  payee: string | null
  category: string | null

  /** Set in the edges manifest only */
  categoryGroup?: string | null

  /** An account Actual has since deleted reads as `(deleted account)` */
  transferTo: string | null
  isStartingBalance: boolean
  isSplitChild: boolean
  notes: string | null
}

export interface ActualManifest {
  asOf: string
  budgetType: 'envelope' | 'tracking'
  currency: string | null
  accounts: { name: string; offBudget: boolean; closed: boolean; balance: string; rowTotal: string }[]
  accountMonths: { account: string; month: string; count: number; total: string }[]
  categoryMonths: { categoryGroup?: string; category: string; month: string; total: string }[]
  budgets: {
    category: string
    categoryGroup?: string
    hidden?: boolean
    isIncome: boolean
    month: string
    budgeted: string
    carryover: boolean
  }[]
  transfers: { date: string; from: string; to: string; amount: string; category: string | null }[]
  afterAsOf: ActualManifestRow[]
  rows: ActualManifestRow[]
}

export function readActualFixture(budget: ActualFixtureBudget, name: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(new URL(`../fixtures/${budget}/${name}`, import.meta.url)))
}

export function readActualManifest(budget: ActualFixtureBudget): ActualManifest {
  return JSON.parse(new TextDecoder().decode(readActualFixture(budget, 'manifest.json'))) as ActualManifest
}

export function unzipActualDatabase(zip: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(unzipSync(zip)['db.sqlite'])
}

export async function readActualFixtureBudget(name: ActualFixtureBudget): Promise<ActualBudgetFile> {
  const read = await readActualBudgetFile(new File([readActualFixture(name, 'export.zip')], 'export.zip'), () => initSqlJs())
  if (read.status !== 'read') throw new Error(read.reason)
  return read.budget
}

/** Reads and normalises one export as of the date its manifest was taken */
export async function normaliseActualFixture(name: ActualFixtureBudget) {
  const manifest = readActualManifest(name)
  const budget = await readActualFixtureBudget(name)
  return { budget, manifest, journal: normaliseActualBudget(budget, manifest.asOf) }
}

/**
 * A budget written by hand for shapes none of the exports hold: a checking and a savings account
 * on the budget, a loan off it, a transfer payee for each and a Car category
 */
export function buildActualBudget(transactions: Array<Partial<ActualTransaction> & Pick<ActualTransaction, 'id' | 'accountId' | 'date' | 'amount'>>, overrides: Partial<ActualBudgetFile> = {}): ActualBudgetFile {
  return {
    budgetName: 'Hand written',
    databaseVersion: null,
    budgetType: 'envelope',
    currencyCode: null,
    budgetDecimals: 2,
    accounts: [
      { id: 'checking', name: 'Checking', offBudget: false, closed: false, type: null },
      { id: 'savings', name: 'Savings', offBudget: false, closed: false, type: null },
      { id: 'loan', name: 'Loan', offBudget: true, closed: false, type: null },
    ],
    payees: [
      { id: 'to-checking', name: '', transferAccountId: 'checking' },
      { id: 'to-savings', name: '', transferAccountId: 'savings' },
      { id: 'to-loan', name: '', transferAccountId: 'loan' },
      { id: 'shop', name: 'Corner Shop', transferAccountId: null },
    ],
    categories: [{ id: 'car', name: 'Car', groupName: 'Bills', isIncome: false, hidden: false }],
    transactions: transactions.map((transaction) => ({
      payeeId: null,
      categoryId: null,
      notes: null,
      isParent: false,
      parentId: null,
      transferredId: null,
      isStartingBalance: false,
      ...transaction,
    })),
    budgetFigures: [],
    ...overrides,
  }
}
