/**
 * Tests turning real Actual Budget exports into the rows the import uploads, checked against what
 * the Actual server that wrote each export reported for the same data
 */
import { describe, expect, it } from 'vitest'
import { JOURNAL_NO_CATEGORY_SOURCE } from '@/api/provider-imports'
import {
  ACTUAL_PAYEE_NAME_MAX_LENGTH,
  ACTUAL_TAG_NAME_MAX_LENGTH,
  ACTUAL_TRANSFER_SIDE_LEFT_OUT_REASON,
  getActualPayeeTooLongReason,
  getActualTagTooLongReason,
  getActualUnbalancedSplitReason,
} from '@/pages/imports/actual/constants'
import { MAX_IMPORT_NOTES_LENGTH, MAX_IMPORT_TAGS_PER_ROW, getRowNotesTooLongReason, getRowTooManyTagsReason } from '@/pages/imports/constants'
import type { ActualJournal } from '@/pages/imports/actual/types'
import { formatHundredths, normaliseActualBudget, readActualTags } from '@/pages/imports/actual/utils/normalise'
import { buildActualBudget, normaliseActualFixture as normalise } from './fixtures'

/** Sums what the uploaded rows move in and out of each account, keyed by account name */
function getBalances(journal: ActualJournal) {
  return new Map(journal.accounts.map((account) => [account.name, formatHundredths(account.balance)]))
}

function getCategoryLabel(journal: ActualJournal, sourceId: string | null) {
  return journal.categories.find((source) => source.id === sourceId)?.label ?? null
}

describe('normalising Actual Budget exports', () => {
  it('uploads every envelope row, leaving each account at the balance Actual showed on the export date', async () => {
    const { journal, manifest } = await normalise('envelope')

    const balances = getBalances(journal)
    for (const account of manifest.accounts) expect(balances.get(account.name)).toBe(account.balance)

    // Transfers are uploaded once, from the side money leaves
    expect(journal.entries.filter((entry) => entry.type === 'transfer')).toHaveLength(manifest.transfers.length)

    // Rows dated after the export date come across too, counted toward no balance until their date
    expect(journal.skippedRows).toEqual([])
    const accountName = new Map(journal.accounts.map((source) => [source.id, source.name]))
    for (const row of manifest.afterAsOf) {
      expect(journal.entries.some((entry) => (
        entry.date === row.date && accountName.get(entry.sourceAccountId ?? entry.destinationAccountId ?? '') === row.account
      ))).toBe(true)
    }
    expect(journal.accounts.filter((source) => source.hasFutureRows).map((source) => source.name).sort())
      .toEqual([...new Set(manifest.afterAsOf.map((row) => row.account))].sort())
  })

  it('keeps the category of a payment to an off-budget account on its budget-side leg alone', async () => {
    const { journal, manifest } = await normalise('envelope')

    const categorized = journal.entries.filter((entry) => entry.categoryLeg)
    expect(categorized).toHaveLength(manifest.transfers.filter((transfer) => transfer.category).length)
    expect(new Set(categorized.map((entry) => entry.categoryLeg))).toEqual(new Set(['source']))
    expect(new Set(categorized.map((entry) => getCategoryLabel(journal, entry.categorySourceId))))
      .toEqual(new Set(manifest.transfers.flatMap((transfer) => (transfer.category ? [`${transfer.category} (transfers)`] : []))))
  })

  it('gives each category paid to an off-budget account a spending source, and names the account paid', async () => {
    const { journal, manifest } = await normalise('envelope')
    const sources = (name: string) => journal.categories.filter((source) => source.categoryId && source.label.startsWith(name))

    // Car Payment and Investing are used only on payments, so their spending sources have no rows
    for (const name of ['Car Payment', 'Investing']) {
      expect(sources(name).map((source) => [source.role, source.label, source.createName, source.rowCount === 0])).toEqual([
        ['spending', name, name, true],
        ['transfer', `${name} (transfers)`, `${name} Transfers`, false],
      ])
    }

    const accountName = new Map(journal.accounts.map((source) => [source.id, source.name]))
    for (const entry of journal.entries.filter((candidate) => candidate.categoryLeg === 'source')) {
      expect(entry.counterpartAccountName).toBe(accountName.get(entry.destinationAccountId!))
    }
    expect(manifest.transfers.some((transfer) => transfer.category === 'Car Payment')).toBe(true)
  })

  it('files each budget category with what Actual counted against it', async () => {
    const { journal, manifest } = await normalise('envelope')
    const account = new Map(journal.accounts.map((source) => [source.id, source]))
    const categoryName = new Map(journal.categories.map((source) => [source.id, source.categoryId ? source.label.replace(/ \(transfers\)$/, '') : '']))

    // Lumina's budgets count a category in every account, so each categorised leg has to sit in an
    // account on Actual's budget for the totals to agree. Signed from that account's side
    const categorised = new Set(journal.categories.filter((source) => source.categoryId).map((source) => source.id))
    const totals = new Map<string, number>()
    for (const entry of journal.entries) {
      if (entry.type === 'opening balance' || !entry.categorySourceId || !categorised.has(entry.categorySourceId)) continue
      const budgetAccountId = entry.categoryLeg === 'destination' ? entry.destinationAccountId : entry.sourceAccountId ?? entry.destinationAccountId
      expect(budgetAccountId && account.get(budgetAccountId)?.offBudget, entry.transactionId).toBe(false)
      if (!budgetAccountId) continue
      const signed = budgetAccountId === entry.sourceAccountId ? -entry.amount : entry.amount
      const key = `${categoryName.get(entry.categorySourceId)}|${entry.date.slice(0, 7)}`
      totals.set(key, (totals.get(key) ?? 0) + signed)
    }

    // Actual files opening balances under Starting Balances, where Lumina records a Balance Adjustment
    const expected = manifest.categoryMonths.filter((month) => month.category && month.category !== 'Starting Balances')
    expect(expected.length).toBeGreaterThan(0)
    for (const month of expected) {
      expect(formatHundredths(totals.get(`${month.category}|${month.month}`) ?? 0), `${month.category} ${month.month}`).toBe(month.total)
    }
  })

  it('reads tags from notes and keeps the notes as written', async () => {
    const { journal } = await normalise('envelope')

    const flight = journal.entries.find((entry) => entry.notes === 'Flight to Lisbon #travel #summer-2025')
    expect(flight?.tags).toEqual(['travel', 'summer-2025'])
    expect(readActualTags('Paid ##not-a-tag and #Food then #food again')).toEqual(['Food'])
    expect(readActualTags('#one#two and x#three')).toEqual(['one', 'two', 'three'])
  })

  it('handles deleted accounts, splits, zero transfers and shared category names the way Actual shows them', async () => {
    const { journal, manifest } = await normalise('edges')
    const label = (entry: ActualJournal['entries'][number]) => getCategoryLabel(journal, entry.categorySourceId)

    // The split edited out of balance is left out whole, so Checking ends 95.00 short of Actual
    expect(journal.skippedRows.map((row) => [row.date, row.amount])).toEqual([['2026-07-10', -9000]])
    expect(journal.skippedRows[0].reason).toMatch(/add up to -95\.00, not the -90\.00/)
    const balances = getBalances(journal)
    for (const account of manifest.accounts) {
      const expected = account.name === 'Checking' ? (Number(account.balance) + 95).toFixed(2) : account.balance
      expect(balances.get(account.name), account.name).toBe(expected)
    }

    // A split part that is a transfer pairs with its other side, keeping the parent's notes first
    const putAside = journal.entries.find((entry) => entry.date === '2026-07-09' && entry.type === 'transfer')
    expect(putAside).toMatchObject({ amount: 6000, notes: 'Trip shop #holiday\nPut aside', tags: ['holiday'], categoryLeg: null })
    expect(journal.entries.filter((entry) => entry.date === '2026-07-08')).toMatchObject([{ type: 'transfer', amount: 0 }])

    // Actual blanked the other side of transfers to deleted accounts, so they read as it shows them
    const toDeleted = journal.entries.filter((entry) => ['2026-07-06', '2026-07-07'].includes(entry.date))
    expect(toDeleted.map((entry) => [entry.type, entry.payeeName, label(entry)])).toEqual([
      ['withdrawal', null, 'No category'],
      ['withdrawal', null, 'Car'],
    ])

    // Treats was merged into Snacks, which was then deleted
    expect(journal.entries.find((entry) => entry.date === '2026-07-11')?.categorySourceId).toBe(JOURNAL_NO_CATEGORY_SOURCE)

    const sources = journal.categories.map((source) => [source.role, source.label, source.createName])
    expect(sources).toEqual([
      ['spending', 'Car', 'Car'],
      ['spending', 'Groceries', 'Groceries'],
      ['spending', 'Gym', 'Gym'],
      ['spending', 'Income', 'Income'],
      ['spending', 'Travel (Away)', 'Travel (Away)'],
      ['spending', 'Travel (Home)', 'Travel (Home)'],
      ['transfer', 'Car (transfers)', 'Car Transfers'],
      ['uncategorized', 'No category', 'Miscellaneous'],
      ['offBudgetUncategorized', 'No category · Car Loan', 'Car Loan'],
    ])
  })

  it('reads the yen budget in hundredths, whatever the currency', async () => {
    const { journal, manifest } = await normalise('yen')

    const balances = getBalances(journal)
    for (const account of manifest.accounts) expect(balances.get(account.name)).toBe(account.balance)
    expect(journal.entries.find((entry) => entry.date === '2026-07-10')).toMatchObject({ amount: 458000, payeeName: 'Lawson' })
  })

  it('imports a row dated after today, counting it toward no balance yet', () => {
    const budget = buildActualBudget([
      { id: 'today', accountId: 'checking', date: '2026-09-26', amount: -1000, payeeId: 'shop' },
      { id: 'tomorrow', accountId: 'checking', date: '2026-09-27', amount: -2500, payeeId: 'shop' },
    ])
    const journal = normaliseActualBudget(budget, '2026-09-26')

    expect(journal.entries.map((entry) => entry.transactionId)).toEqual(['today', 'tomorrow'])
    expect(journal.skippedRows).toEqual([])
    expect(journal.accounts.find((source) => source.id === 'checking')).toMatchObject({ balance: -1000, rowCount: 2, hasFutureRows: true })
  })

  it('marks both accounts of a transfer dated after today as holding a future row', () => {
    const budget = buildActualBudget([
      { id: 'out', accountId: 'checking', date: '2026-09-30', amount: -5000, payeeId: 'to-savings', transferredId: 'in' },
      { id: 'in', accountId: 'savings', date: '2026-09-30', amount: 5000, payeeId: 'to-checking', transferredId: 'out' },
    ])
    const journal = normaliseActualBudget(budget, '2026-09-26')

    expect(journal.entries).toMatchObject([{ transactionId: 'out', type: 'transfer', sourceAccountId: 'checking', destinationAccountId: 'savings' }])
    expect(journal.accounts.map((source) => [source.id, source.balance, source.hasFutureRows])).toEqual([
      ['checking', 0, true],
      ['savings', 0, true],
      ['loan', 0, false],
    ])
  })
})

describe('pairing Actual Budget transfers', () => {
  const TODAY = '2026-09-26'

  it('pairs two sides that link to each other on one day for opposite amounts', () => {
    const journal = normaliseActualBudget(buildActualBudget([
      { id: 'out', accountId: 'checking', date: '2026-09-01', amount: -5000, payeeId: 'to-savings', transferredId: 'in' },
      { id: 'in', accountId: 'savings', date: '2026-09-01', amount: 5000, payeeId: 'to-checking', transferredId: 'out' },
    ]), TODAY)

    expect(journal.entries).toMatchObject([
      { transactionId: 'out', type: 'transfer', sourceAccountId: 'checking', destinationAccountId: 'savings', amount: 5000, categoryLeg: null },
    ])
  })

  it('imports each side on its own when the two do not match, as money to or from outside', () => {
    const journal = normaliseActualBudget(buildActualBudget([
      // Linked one way only
      { id: 'one-way-out', accountId: 'checking', date: '2026-09-01', amount: -1000, payeeId: 'to-savings', transferredId: 'one-way-in' },
      { id: 'one-way-in', accountId: 'savings', date: '2026-09-01', amount: 1000, payeeId: 'to-checking' },
      // A day apart
      { id: 'late-out', accountId: 'checking', date: '2026-09-02', amount: -2000, payeeId: 'to-savings', transferredId: 'late-in' },
      { id: 'late-in', accountId: 'savings', date: '2026-09-03', amount: 2000, payeeId: 'to-checking', transferredId: 'late-out' },
      // Amounts that differ
      { id: 'short-out', accountId: 'checking', date: '2026-09-04', amount: -3000, payeeId: 'to-savings', transferredId: 'short-in' },
      { id: 'short-in', accountId: 'savings', date: '2026-09-04', amount: 2900, payeeId: 'to-checking', transferredId: 'short-out' },
      // The other side sits in a split that doesn't add up, which is left out
      { id: 'split', accountId: 'savings', date: '2026-09-05', amount: 10000, isParent: true },
      { id: 'split-transfer', accountId: 'savings', date: '2026-09-05', amount: 6000, parentId: 'split', payeeId: 'to-checking', transferredId: 'split-out' },
      { id: 'split-rest', accountId: 'savings', date: '2026-09-05', amount: 3000, parentId: 'split', categoryId: 'car' },
      { id: 'split-out', accountId: 'checking', date: '2026-09-05', amount: -6000, payeeId: 'to-savings', transferredId: 'split-transfer' },
      // Both sides in one account
      { id: 'self-out', accountId: 'checking', date: '2026-09-06', amount: -4000, payeeId: 'to-checking', transferredId: 'self-in' },
      { id: 'self-in', accountId: 'checking', date: '2026-09-06', amount: 4000, payeeId: 'to-checking', transferredId: 'self-out' },
      // The other side names a third account rather than this one
      { id: 'astray-out', accountId: 'checking', date: '2026-09-07', amount: -7000, payeeId: 'to-savings', transferredId: 'astray-in' },
      { id: 'astray-in', accountId: 'savings', date: '2026-09-07', amount: 7000, payeeId: 'to-loan', transferredId: 'astray-out' },
      // A split parent whose parts are all gone, on either side
      { id: 'emptied-out', accountId: 'checking', date: '2026-09-08', amount: -8000, isParent: true, payeeId: 'to-savings', transferredId: 'plain-in' },
      { id: 'plain-in', accountId: 'savings', date: '2026-09-08', amount: 8000, payeeId: 'to-checking', transferredId: 'emptied-out' },
      { id: 'plain-out', accountId: 'checking', date: '2026-09-09', amount: -9000, payeeId: 'to-savings', transferredId: 'emptied-in' },
      { id: 'emptied-in', accountId: 'savings', date: '2026-09-09', amount: 9000, isParent: true, payeeId: 'to-checking', transferredId: 'plain-out' },
    ]), TODAY)

    expect(journal.entries.map((entry) => [entry.transactionId, entry.type, entry.categorySourceId])).toEqual([
      ['one-way-out', 'withdrawal', 'transfer:'],
      ['one-way-in', 'deposit', 'transfer:'],
      ['late-out', 'withdrawal', 'transfer:'],
      ['late-in', 'deposit', 'transfer:'],
      ['short-out', 'withdrawal', 'transfer:'],
      ['short-in', 'deposit', 'transfer:'],
      ['split-out', 'withdrawal', 'transfer:'],
      ['self-out', 'withdrawal', 'transfer:'],
      ['self-in', 'deposit', 'transfer:'],
      ['astray-out', 'withdrawal', 'transfer:'],
      ['astray-in', 'deposit', 'transfer:'],
      ['emptied-out', 'withdrawal', 'transfer:'],
      ['plain-in', 'deposit', 'transfer:'],
      ['plain-out', 'withdrawal', 'transfer:'],
      ['emptied-in', 'deposit', 'transfer:'],
    ])
    expect(journal.skippedRows.map((row) => row.transactionId)).toEqual(['split'])
    expect(journal.categories.map((source) => [source.id, source.role, source.label, source.createName])).toEqual([
      ['transfer:', 'transfer', 'Transfers whose other side is missing', 'Transfer'],
    ])
  })

  it('puts the category on the destination leg when money comes into the budget from an off-budget account', () => {
    const journal = normaliseActualBudget(buildActualBudget([
      { id: 'from-loan', accountId: 'loan', date: '2026-09-01', amount: -50000, payeeId: 'to-checking', transferredId: 'into-checking' },
      { id: 'into-checking', accountId: 'checking', date: '2026-09-01', amount: 50000, payeeId: 'to-loan', transferredId: 'from-loan', categoryId: 'car' },
    ]), TODAY)

    expect(journal.entries).toMatchObject([{
      transactionId: 'from-loan',
      type: 'transfer',
      sourceAccountId: 'loan',
      destinationAccountId: 'checking',
      categorySourceId: 'transfer:car',
      categoryLeg: 'destination',
    }])
  })
})

describe('Actual Budget rows over the import limits', () => {
  it('leaves out and lists rows whose notes, tags or payee the import cannot take', () => {
    const longPayee = 'P'.repeat(ACTUAL_PAYEE_NAME_MAX_LENGTH + 1)
    const longTag = 't'.repeat(ACTUAL_TAG_NAME_MAX_LENGTH + 1)
    const manyTags = Array.from({ length: MAX_IMPORT_TAGS_PER_ROW + 1 }, (_, index) => `#tag${index}`).join(' ')
    const budget = buildActualBudget([
      { id: 'notes', accountId: 'checking', date: '2026-09-01', amount: -100, notes: 'n'.repeat(MAX_IMPORT_NOTES_LENGTH + 1) },
      { id: 'tags', accountId: 'checking', date: '2026-09-01', amount: -100, notes: manyTags },
      { id: 'tag', accountId: 'checking', date: '2026-09-01', amount: -100, notes: `#${longTag}` },
      { id: 'payee', accountId: 'checking', date: '2026-09-01', amount: -100, payeeId: 'long' },
      { id: 'fine', accountId: 'checking', date: '2026-09-01', amount: -100, payeeId: 'shop' },
    ])
    budget.payees.push({ id: 'long', name: longPayee, transferAccountId: null })
    const journal = normaliseActualBudget(budget, '2026-09-26')

    expect(journal.entries.map((entry) => entry.transactionId)).toEqual(['fine'])
    expect(journal.skippedRows.map((row) => [row.transactionId, row.reason])).toEqual([
      ['notes', getRowNotesTooLongReason(MAX_IMPORT_NOTES_LENGTH + 1)],
      ['tags', getRowTooManyTagsReason(MAX_IMPORT_TAGS_PER_ROW + 1)],
      ['tag', getActualTagTooLongReason(longTag)],
      ['payee', getActualPayeeTooLongReason(ACTUAL_PAYEE_NAME_MAX_LENGTH + 1)],
    ])
  })

  it('leaves out both sides of a transfer whose uploaded side is over a limit, and neither when only the other side is', () => {
    const manyTags = Array.from({ length: MAX_IMPORT_TAGS_PER_ROW + 1 }, (_, index) => `#tag${index}`).join(' ')
    const pair = (prefix: string, outNotes: string | null, inNotes: string | null) => [
      { id: `${prefix}-in`, accountId: 'savings', date: '2026-09-01', amount: 5000, payeeId: 'to-checking', transferredId: `${prefix}-out`, notes: inNotes },
      { id: `${prefix}-out`, accountId: 'checking', date: '2026-09-01', amount: -5000, payeeId: 'to-savings', transferredId: `${prefix}-in`, notes: outNotes },
    ]
    const journal = normaliseActualBudget(buildActualBudget([...pair('busy-out', manyTags, null), ...pair('busy-in', null, manyTags)]), '2026-09-26')

    expect(journal.entries.map((entry) => [entry.transactionId, entry.type])).toEqual([['busy-in-out', 'transfer']])
    expect(journal.skippedRows.map((row) => [row.transactionId, row.reason])).toEqual([
      ['busy-out-in', ACTUAL_TRANSFER_SIDE_LEFT_OUT_REASON],
      ['busy-out-out', getRowTooManyTagsReason(MAX_IMPORT_TAGS_PER_ROW + 1)],
    ])
  })
})

describe('Actual Budget categories used only on payments to off-budget accounts', () => {
  it('offers a budgeted one as its own category and as a transfer category apart from it', () => {
    const budget = buildActualBudget([
      { id: 'pay', accountId: 'checking', date: '2026-09-01', amount: -30000, payeeId: 'to-loan', transferredId: 'paid', categoryId: 'car' },
      { id: 'paid', accountId: 'loan', date: '2026-09-01', amount: 30000, payeeId: 'to-checking', transferredId: 'pay' },
    ], { budgetFigures: [{ month: '2026-09', categoryId: 'car', amount: 30000, carryover: false }] })
    const journal = normaliseActualBudget(budget, '2026-09-26')

    expect(journal.categories.map((source) => [source.id, source.role, source.createName])).toEqual([
      ['car', 'spending', 'Car'],
      ['transfer:car', 'transfer', 'Car Transfers'],
    ])
  })

  it('names a category apart from a built-in transfer category it would otherwise reuse', () => {
    const budget = buildActualBudget([
      { id: 'pay', accountId: 'checking', date: '2026-09-01', amount: -30000, payeeId: 'to-loan', transferredId: 'paid', categoryId: 'transfer' },
      { id: 'paid', accountId: 'loan', date: '2026-09-01', amount: 30000, payeeId: 'to-checking', transferredId: 'pay' },
    ], { categories: [{ id: 'transfer', name: 'transfer', groupName: 'Bills', isIncome: false, hidden: false }] })

    expect(normaliseActualBudget(budget, '2026-09-26').categories.map((source) => source.createName)).toEqual(['transfer Payments', 'transfer Transfers'])
  })

  it('writes amounts in the decimal places of a yen budget, keeping cents only where an amount has them', () => {
    expect(formatHundredths(-458000, 0)).toBe('-4580')
    expect(formatHundredths(-6420, 0)).toBe('-64.20')
    expect(formatHundredths(5, 2)).toBe('0.05')

    const budget = buildActualBudget([
      { id: 'split', accountId: 'checking', date: '2026-09-01', amount: -900000, isParent: true },
      { id: 'part', accountId: 'checking', date: '2026-09-01', amount: -950000, parentId: 'split' },
    ], { currencyCode: 'JPY', budgetDecimals: 0 })
    expect(normaliseActualBudget(budget, '2026-09-26').skippedRows[0].reason).toBe(getActualUnbalancedSplitReason('-9500', '-9000'))
  })
})

describe('Actual Budget accounts sharing a name', () => {
  it('tells them apart by where each sits, numbering those that sit alike', () => {
    const budget = buildActualBudget([], {
      accounts: [
        { id: 'a', name: 'Cash', offBudget: false, closed: false, type: null },
        { id: 'b', name: 'cash', offBudget: false, closed: false, type: null },
        { id: 'c', name: 'Cash', offBudget: true, closed: true, type: null },
        { id: 'd', name: 'Visa', offBudget: false, closed: false, type: null },
      ],
    })

    expect(normaliseActualBudget(budget, '2026-09-26').accounts.map((account) => account.label)).toEqual([
      'Cash (on budget, 1)',
      'cash (on budget, 2)',
      'Cash (off budget, closed)',
      'Visa',
    ])
  })
})

describe('Actual Budget categories counted the way Actual counts them', () => {
  const TODAY = '2026-09-26'
  const shape = (journal: ActualJournal) => journal.entries.map((entry) => (
    [entry.transactionId, entry.type, entry.categorySourceId, entry.categoryLeg]
  ))

  it('counts a category only on rows in an account on the budget', () => {
    const journal = normaliseActualBudget(buildActualBudget([
      // Categorised before the loan left the budget, so Actual no longer counts it
      { id: 'off', accountId: 'loan', date: '2026-09-01', amount: -2500, categoryId: 'car' },
      // A payment whose sides don't pair, each still carrying the category
      { id: 'late-out', accountId: 'checking', date: '2026-09-02', amount: -5000, payeeId: 'to-loan', transferredId: 'late-in', categoryId: 'car' },
      { id: 'late-in', accountId: 'loan', date: '2026-09-03', amount: 5000, payeeId: 'to-checking', transferredId: 'late-out', categoryId: 'car' },
    ]), TODAY)

    expect(shape(journal)).toEqual([
      ['off', 'withdrawal', 'off-budget:loan', null],
      ['late-out', 'withdrawal', 'transfer:car', null],
      ['late-in', 'deposit', 'transfer:', null],
    ])
  })

  it('keeps the category of a transfer between two accounts on the budget, and splits a pair where both sides count one', () => {
    const journal = normaliseActualBudget(buildActualBudget([
      { id: 'one-in', accountId: 'savings', date: '2026-09-01', amount: 5000, payeeId: 'to-checking', transferredId: 'one-out', categoryId: 'car' },
      { id: 'one-out', accountId: 'checking', date: '2026-09-01', amount: -5000, payeeId: 'to-savings', transferredId: 'one-in' },
      { id: 'both-out', accountId: 'checking', date: '2026-09-02', amount: -3000, payeeId: 'to-savings', transferredId: 'both-in', categoryId: 'car' },
      { id: 'both-in', accountId: 'savings', date: '2026-09-02', amount: 3000, payeeId: 'to-checking', transferredId: 'both-out', categoryId: 'car' },
    ]), TODAY)

    expect(shape(journal)).toEqual([
      ['one-out', 'transfer', 'transfer:car', 'destination'],
      ['both-out', 'withdrawal', 'transfer:car', null],
      ['both-in', 'deposit', 'transfer:car', null],
    ])
  })

  it('imports a split parent left with no parts as an ordinary row', () => {
    const journal = normaliseActualBudget(buildActualBudget([
      { id: 'emptied', accountId: 'checking', date: '2026-09-01', amount: -1200, isParent: true, payeeId: 'shop', categoryId: 'car' },
    ]), TODAY)

    expect(shape(journal)).toEqual([['emptied', 'withdrawal', 'car', null]])
    expect(journal.skippedRows).toEqual([])
  })
})
