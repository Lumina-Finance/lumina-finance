import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkExpected, compareImport } from '../firefly-check/compare.ts'

const endpoint = (name, amount) => ({ name, type: 'Asset account', imported: true, amount })
const outside = (name) => ({ name, type: 'Expense account', imported: false, amount: null })
const row = (fields) => ({
  groupTitle: '', category: '', budget: '', tags: [], notes: '', foreign: null, afterAsOf: false, ...fields,
})

// A grocery run on a food budget, a book paid in dollars and a move to savings, as Firefly III reports them
const MANIFEST = {
  asOf: '2025-12-31',
  exportStart: '2025-01-01',
  accounts: [
    { name: 'Checking', type: 'Asset account', role: 'defaultAsset', liabilityDirection: null, currency: 'EUR', active: true, balance: '-40.50', rowTotal: '-40.50' },
    { name: 'Savings', type: 'Asset account', role: 'savingAsset', liabilityDirection: null, currency: 'EUR', active: true, balance: '10.00', rowTotal: '10.00' },
  ],
  accountMonths: [
    { account: 'Checking', accountType: 'Asset account', month: '2025-03', count: 3, total: '-40.50' },
    { account: 'Savings', accountType: 'Asset account', month: '2025-03', count: 1, total: '10.00' },
  ],
  categoryMonths: [
    { category: 'Books', month: '2025-03', currency: 'EUR', total: '-18.00' },
    { category: 'Groceries', month: '2025-03', currency: 'EUR', total: '-12.50' },
  ],
  rows: [
    row({
      date: '2025-03-04', type: 'withdrawal', description: 'Weekly shop', groupTitle: 'Big Store run',
      source: endpoint('Checking', '-12.50'), destination: outside('FreshMart'),
      category: 'Groceries', budget: 'Food', tags: ['food', 'weekly'], notes: 'Paid by card',
    }),
    row({
      date: '2025-03-05', type: 'transfer', description: 'To savings',
      source: endpoint('Checking', '-10.00'), destination: endpoint('Savings', '10.00'), category: 'Savings plan',
    }),
    row({
      date: '2025-03-06', type: 'withdrawal', description: 'Book from the US',
      source: endpoint('Checking', '-18.00'), destination: outside('Bookshop'),
      category: 'Books', foreign: { amount: '19.99', currency: 'USD' },
    }),
  ],
  budgets: [{ name: 'Food', active: true, limits: [{ start: '2025-03-01', end: '2025-03-31', amount: '300.00', currency: 'EUR' }] }],
}

const RUN_INFO = { fireflyVersion: '6.7.3', exportEnd: '2026-09-25' }


function buildLumina() {
  const account = (id, name, type, balance) => ({
    id, name, account_type: type, currency: 'EUR', current_balance: balance, is_archived: false,
  })
  const transaction = (fields) => ({
    merchant_name: null, category_id: 'transfer', notes: null, tags: [], counterparty_account_id: null, currency: 'EUR',
    ...fields,
    original_amount: fields.original_amount ?? fields.amount,
  })
  return {
    accounts: [account('c', 'Checking', 'checking', -4050), account('s', 'Savings', 'savings', 1000)],
    categories: [{ id: 'g', name: 'Groceries' }, { id: 'b', name: 'Books' }, { id: 'transfer', name: 'Transfer' }],
    transactions: [
      transaction({
        account_id: 'c', dt: '2025-03-04', amount: -1250, merchant_name: 'FreshMart', category_id: 'g',
        notes: 'Weekly shop\nSplit transaction: Big Store run\nPaid by card', tags: [{ name: 'weekly' }, { name: 'food' }],
      }),
      transaction({ account_id: 'c', dt: '2025-03-05', amount: -1000, counterparty_account_id: 's', notes: 'To savings' }),
      transaction({ account_id: 's', dt: '2025-03-05', amount: 1000, counterparty_account_id: 'c', notes: 'To savings' }),
      transaction({
        account_id: 'c', dt: '2025-03-06', amount: -1800, original_amount: -1999, currency: 'USD',
        merchant_name: 'Bookshop', category_id: 'b', notes: 'Book from the US',
      }),
    ],
    baseBudgets: [{ id: 'food', name: 'Food', currency: 'EUR', is_archived: false, category_ids: ['g'] }],
    budgetPeriods: [{ base_budget_id: 'food', period_start: '2025-03-01', period_end: '2025-03-31', overall_limit: 30000 }],
  }
}

const describeAll = (lumina, manifest = MANIFEST) => compareImport(manifest, RUN_INFO, lumina)
  .map((difference) => `${difference.kind}: ${difference.subject} = ${difference.lumina}`)
  .sort()

test('an import holding what Firefly III reports differs only by the transfer category it drops', () => {
  assert.deepEqual(describeAll(buildLumina()), ['transfer-category-dropped: Savings plan = Transfer'])
})

test('each way an import can go wrong is reported under its own kind', () => {
  const lumina = buildLumina()
  lumina.transactions[0].notes = 'Weekly shop\nPaid by card'
  lumina.transactions[2].category_id = 'g'
  lumina.transactions[3].original_amount = -1800
  lumina.transactions[3].currency = 'EUR'
  lumina.accounts[1].account_type = 'checking'
  lumina.accounts.push({ id: 'x', name: 'FreshMart', account_type: 'checking', currency: 'EUR', current_balance: 0, is_archived: false })
  lumina.baseBudgets[0].category_ids = ['b']

  assert.deepEqual(describeAll(lumina), [
    'account-extra: FreshMart = checking',
    'account-type: Savings = checking',
    'budget-categories: Food = Books',
    'row-foreign-amount: Book from the US = EUR only',
    'row-notes: 2025-03-04 Weekly shop = Weekly shop\nPaid by card',
    'transfer-category-dropped: Savings plan = Groceries',
    'transfer-category-dropped: Savings plan = Transfer',
    'transfer-category: 2025-03-05 To savings = Groceries',
  ])
})

test('a transfer that lost a leg is reported, and its other leg is not counted as extra', () => {
  const lumina = buildLumina()
  lumina.transactions.splice(2, 1)
  assert.deepEqual(describeAll(lumina), [
    'account-month: Savings 2025-03 = 0 rows, 0.00',
    'transfer-category-dropped: Savings plan = Transfer',
    'transfer-missing: 2025-03-05 To savings = absent',
  ])
})

// An asset account and a loan both named Boat, as Firefly III allows, with a payment between them
const BOAT_ASSET = { name: 'Boat', type: 'Asset account', role: 'defaultAsset', liabilityDirection: null, currency: 'EUR', active: true }
const BOAT_LOAN = { name: 'Boat', type: 'Loan', role: 'loan', liabilityDirection: 'debit', currency: 'EUR', active: true }
const boatAccount = (id, type, balance) => ({
  id, name: 'Boat', account_type: type, currency: 'EUR', current_balance: balance, is_archived: false,
})

test('accounts sharing a name are each compared with their own Lumina account', () => {
  const manifest = {
    ...MANIFEST,
    accounts: [...MANIFEST.accounts, { ...BOAT_ASSET, balance: '-900.00', rowTotal: '-900.00' }, { ...BOAT_LOAN, balance: '900.00', rowTotal: '900.00' }],
    accountMonths: [
      ...MANIFEST.accountMonths,
      { account: 'Boat', accountType: 'Asset account', month: '2025-03', count: 1, total: '-900.00' },
      { account: 'Boat', accountType: 'Loan', month: '2025-03', count: 1, total: '900.00' },
    ],
    rows: [...MANIFEST.rows, row({
      date: '2025-03-07', type: 'withdrawal', description: 'Toward the boat loan',
      source: endpoint('Boat', '-900.00'), destination: { name: 'Boat', type: 'Loan', imported: true, amount: '900.00' },
    })],
  }

  // Lumina lists the loan first, so pairing by name alone would take it for the asset account
  const lumina = buildLumina()
  lumina.accounts.push(boatAccount('bl', 'loan', 90000), boatAccount('ba', 'checking', -90000))
  lumina.transactions.push(
    { ...lumina.transactions[1], account_id: 'ba', dt: '2025-03-07', amount: -90000, original_amount: -90000, counterparty_account_id: 'bl', notes: 'Toward the boat loan' },
    { ...lumina.transactions[1], account_id: 'bl', dt: '2025-03-07', amount: 90000, original_amount: 90000, counterparty_account_id: 'ba', notes: 'Toward the boat loan' },
  )

  const differences = compareImport(manifest, RUN_INFO, lumina)
  assert.deepEqual(differences.map(({ kind, subject }) => `${kind}: ${subject}`), ['transfer-category-dropped: Savings plan'])
})

test('an account missing from Lumina is reported even when an account of the same name was imported', () => {
  const manifest = {
    ...MANIFEST,
    accounts: [...MANIFEST.accounts, { ...BOAT_ASSET, balance: '0.00', rowTotal: '0.00' }, { ...BOAT_LOAN, balance: '0.00', rowTotal: '0.00' }],
  }
  const lumina = buildLumina()
  lumina.accounts.push(boatAccount('bl', 'loan', 0))

  assert.deepEqual(describeAll(lumina, manifest), [
    'account-missing: Boat (Asset account) = absent',
    'transfer-category-dropped: Savings plan = Transfer',
  ])
})

test('a credit card Firefly III keeps as an asset account pairs with it, apart from a same-named loan', () => {
  const manifest = {
    ...MANIFEST,
    accounts: [...MANIFEST.accounts, { ...BOAT_ASSET, role: 'ccAsset', balance: '0.00', rowTotal: '0.00' }, { ...BOAT_LOAN, balance: '0.00', rowTotal: '0.00' }],
  }
  const lumina = buildLumina()
  lumina.accounts.push(boatAccount('bl', 'loan', 0), boatAccount('bc', 'credit_card', 0))

  assert.deepEqual(describeAll(lumina, manifest), [
    'transfer-category-dropped: Savings plan = Transfer',
  ])
})

test('rows on an extra account are not counted as rows of the account it shares a name with', () => {
  const lumina = buildLumina()
  lumina.accounts.push({ ...lumina.accounts[0], id: 'x', account_type: 'loan', current_balance: 0 })
  lumina.transactions[3].account_id = 'x'

  assert.deepEqual(describeAll(lumina), [
    'account-extra: Checking = loan',
    'account-month: Checking (unpaired loan) 2025-03 = 1 rows',
    'account-month: Checking 2025-03 = 2 rows, -22.50',
    'row-extra: 2025-03-06 Checking (unpaired loan) -1800 = Bookshop',
    'row-missing: 2025-03-06 Book from the US = absent',
    'transfer-category-dropped: Savings plan = Transfer',
  ])
})

test('an expected difference matches only while Lumina holds the value it names', () => {
  const differences = [{ kind: 'account-type', subject: 'Savings', firefly: 'savings', lumina: 'cash' }]
  const expected = [
    { kind: 'account-type', subject: 'Savings', lumina: 'checking', reason: 'guessed' },
    { kind: 'row-tags', subject: '2025-06-10 Tagged', lumina: 'a | b', reason: 'fixed since' },
  ]
  assert.deepEqual(checkExpected(differences, expected), { unexpected: differences, stale: expected })
})
