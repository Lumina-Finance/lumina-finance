/**
 * Tests turning real Actual Budget exports into the rows the import uploads, checked against what
 * the Actual server that wrote each export reported for the same data
 */
import { describe, expect, it } from 'vitest'
import { JOURNAL_NO_CATEGORY_SOURCE } from '@/api/provider-imports'
import { ACTUAL_FUTURE_ROW_REASON } from '@/pages/imports/actual/constants'
import type { ActualJournal } from '@/pages/imports/actual/types'
import { formatHundredths, normaliseActualBudget, readActualTags } from '@/pages/imports/actual/utils/normalise'
import { normaliseActualFixture as normalise, readActualFixtureBudget as readBudget } from './fixtures'

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
})
