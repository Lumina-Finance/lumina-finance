/**
 * Tests turning real Actual Budget exports into the rows the import uploads, checked against what
 * the Actual server that wrote each export reported for the same data
 */
import { describe, expect, it } from 'vitest'
import { JOURNAL_NO_CATEGORY_SOURCE } from '@/api/provider-imports'
import {
  ACTUAL_FUTURE_ROW_REASON,
  ACTUAL_PAYEE_NAME_MAX_LENGTH,
  ACTUAL_TAG_NAME_MAX_LENGTH,
  ACTUAL_TRANSFER_SIDE_LEFT_OUT_REASON,
  getActualPayeeTooLongReason,
  getActualTagTooLongReason,
} from '@/pages/imports/actual/constants'
import { MAX_IMPORT_NOTES_LENGTH, MAX_IMPORT_TAGS_PER_ROW, getRowNotesTooLongReason, getRowTooManyTagsReason } from '@/pages/imports/constants'
import type { ActualJournal } from '@/pages/imports/actual/types'
import { formatHundredths, normaliseActualBudget, readActualTags } from '@/pages/imports/actual/utils/normalise'
import { buildActualBudget, normaliseActualFixture as normalise, readActualFixtureBudget as readBudget } from './fixtures'

/** Sums what the uploaded rows move in and out of each account, keyed by account name */
function getBalances(journal: ActualJournal) {
  return new Map(journal.accounts.map((account) => [account.name, formatHundredths(account.balance)]))
}

function getCategoryLabel(journal: ActualJournal, sourceId: string | null) {
  return journal.categories.find((source) => source.id === sourceId)?.label ?? null
}

describe('normalising Actual Budget exports', () => {
  it('uploads every envelope row up to the export date, leaving each account at the balance Actual showed', async () => {
    const { journal, manifest } = await normalise('envelope')

    const balances = getBalances(journal)
    for (const account of manifest.accounts) expect(balances.get(account.name)).toBe(account.balance)

    // Transfers are uploaded once, from the side money leaves
    expect(journal.entries.filter((entry) => entry.type === 'transfer')).toHaveLength(manifest.transfers.length)
    expect(journal.skippedRows.map((row) => [row.date, row.reason]))
      .toEqual(manifest.afterAsOf.map((row) => [row.date, ACTUAL_FUTURE_ROW_REASON]))
  })

  it('keeps the category of a payment to an off-budget account on its budget-side leg alone', async () => {
    const { journal, manifest } = await normalise('envelope')

    const categorized = journal.entries.filter((entry) => entry.categoryLeg)
    expect(categorized).toHaveLength(manifest.transfers.filter((transfer) => transfer.category).length)
    expect(new Set(categorized.map((entry) => entry.categoryLeg))).toEqual(new Set(['source']))
    expect(new Set(categorized.map((entry) => getCategoryLabel(journal, entry.categorySourceId))))
      .toEqual(new Set(manifest.transfers.flatMap((transfer) => (transfer.category ? [`${transfer.category} · transfers to and from off-budget accounts`] : []))))
  })

  it('files each budget category with what Actual counted against it', async () => {
    const { journal, manifest } = await normalise('envelope')
    const account = new Map(journal.accounts.map((source) => [source.id, source]))
    const categoryName = new Map(journal.categories.map((source) => [source.id, source.categoryId ? source.label.split(' · ')[0] : '']))

    // Budget-side rows only, signed from the budget account's side, as Actual's category totals are
    const totals = new Map<string, number>()
    for (const entry of journal.entries) {
      if (entry.type === 'opening balance' || !entry.categorySourceId) continue
      const budgetAccountId = entry.categoryLeg === 'destination' ? entry.destinationAccountId : entry.sourceAccountId ?? entry.destinationAccountId
      if (!budgetAccountId || account.get(budgetAccountId)?.offBudget) continue
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
      ['transfer', 'Car · transfers to and from off-budget accounts', 'Car Transfers'],
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

  it('leaves out rows dated after today in the user timezone', async () => {
    const budget = await readBudget('yen')
    const journal = normaliseActualBudget(budget, '2026-08-04')

    expect(journal.skippedRows.every((row) => row.date > '2026-08-04')).toBe(true)
    expect(journal.entries.every((entry) => entry.date <= '2026-08-04')).toBe(true)
    expect(journal.skippedRows.length).toBeGreaterThan(0)
  })

  it('keeps a row dated today and leaves out one dated tomorrow', () => {
    const budget = buildActualBudget([
      { id: 'today', accountId: 'checking', date: '2026-09-26', amount: -1000, payeeId: 'shop' },
      { id: 'tomorrow', accountId: 'checking', date: '2026-09-27', amount: -1000, payeeId: 'shop' },
    ])
    const journal = normaliseActualBudget(budget, '2026-09-26')

    expect(journal.entries.map((entry) => entry.transactionId)).toEqual(['today'])
    expect(journal.skippedRows.map((row) => [row.transactionId, row.reason])).toEqual([['tomorrow', ACTUAL_FUTURE_ROW_REASON]])
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
    ]), TODAY)

    expect(journal.entries.map((entry) => [entry.transactionId, entry.type, entry.categorySourceId])).toEqual([
      ['one-way-out', 'withdrawal', 'transfer:'],
      ['one-way-in', 'deposit', 'transfer:'],
      ['late-out', 'withdrawal', 'transfer:'],
      ['late-in', 'deposit', 'transfer:'],
      ['short-out', 'withdrawal', 'transfer:'],
      ['short-in', 'deposit', 'transfer:'],
      ['split-out', 'withdrawal', 'transfer:'],
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
  it('offers a budgeted one as a single transfer category named after it', () => {
    const budget = buildActualBudget([
      { id: 'pay', accountId: 'checking', date: '2026-09-01', amount: -30000, payeeId: 'to-loan', transferredId: 'paid', categoryId: 'car' },
      { id: 'paid', accountId: 'loan', date: '2026-09-01', amount: 30000, payeeId: 'to-checking', transferredId: 'pay' },
    ], { budgetFigures: [{ month: '2026-09', categoryId: 'car', amount: 30000, carryover: false }] })
    const journal = normaliseActualBudget(budget, '2026-09-26')

    expect(journal.categories.map((source) => [source.id, source.role, source.createName])).toEqual([['transfer:car', 'transfer', 'Car']])
  })
})
