/**
 * The upload the import screen builds for the envelope export, which the backend test
 * backend/tests/routes/transactions/test_actual_real_export.py commits and checks against the same
 * manifest, so the two halves of the import are checked against Actual's own figures together
 *
 * Every account and category is created, in CAD, since the export has Actual's currency feature
 * off. To refresh the recorded upload after a deliberate change to what the screen sends, run this
 * test with WRITE_ACTUAL_REPLAY=1 set, and review the difference before committing it
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import { buildJournalStageBatches, type ImportRunBudgets, type JournalImportStageBatch } from '@/api/provider-imports'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import { buildActualBudgetDrafts, buildActualRunBudgets } from '@/pages/imports/actual/utils/budgets'
import { getActualCategoryKind } from '@/pages/imports/actual/utils/categories'
import { buildActualImportPayload } from '@/pages/imports/actual/utils/payload'
import { normaliseActualFixture } from './fixtures'

const REPLAY = new URL('../../../../../../backend/tests/fixtures/actual/envelope-upload.json', import.meta.url)
const CURRENCIES = [{ id: 'CAD', name: 'Canadian dollar', symbol: '$', minor_unit_exponent: 2 }] as Currency[]

interface Replay {
  transactions: JournalImportStageBatch[]
  budgets: ImportRunBudgets | null
  archive: string[]
  expected: {
    accounts: { name: string; offBudget: boolean; closed: boolean; balance: string }[]

    /** Actual's monthly total for each category, with the category sources its rows are filed under */
    categoryMonths: { sources: string[]; month: string; total: string }[]
    budgets: { name: string; hidden: boolean; months: { month: string; budgeted: string }[] }[]
  }
}

async function buildReplay(): Promise<Replay> {
  const { budget, journal, manifest } = await normaliseActualFixture('envelope')
  const drafts = buildActualBudgetDrafts(budget, journal, manifest.asOf.slice(0, 7)).filter((draft) => !draft.disabledReason)
  const build = buildActualImportPayload(journal, {
    accountMappings: Object.fromEntries(journal.accounts.map((account) => [account.id, CREATE_ACCOUNT_VALUE])),
    accountCreateDetails: Object.fromEntries(journal.accounts.map((account) => [
      account.id,
      { accountType: account.proposedType, currency: 'CAD', institutionId: '' },
    ])),
    accountById: new Map(),
    categoryMappings: Object.fromEntries(journal.categories.map((source) => [source.id, CREATE_CATEGORY_VALUE])),
    categoryCreateKinds: Object.fromEntries(journal.categories.map((source) => [source.id, getActualCategoryKind(source)])),
    categoryById: new Map(),
    currencies: CURRENCIES,
    budgetCategorySources: new Set(drafts.flatMap((draft) => draft.categorySourceIds)),
  })
  expect(build.errors).toEqual([])

  // Starting Balances is where Actual files opening balances, which Lumina records as balance adjustments
  const liveCategories = budget.categories
  const expectedMonths = manifest.categoryMonths.filter((month) => month.category && month.category !== 'Starting Balances')
  const budgetMonths = new Map<string, { month: string; budgeted: string }[]>()
  for (const figure of manifest.budgets) {
    if (figure.isIncome || Number(figure.budgeted) <= 0) continue
    budgetMonths.set(figure.category, [...(budgetMonths.get(figure.category) ?? []), { month: figure.month, budgeted: figure.budgeted }])
  }

  return {
    transactions: await buildJournalStageBatches(build.payload!),
    budgets: buildActualRunBudgets(drafts, 'CAD', budget.budgetDecimals, 2, build.budgetCategoryMappings),
    archive: build.archiveAccountSources,
    expected: {
      accounts: manifest.accounts.map(({ name, offBudget, closed, balance }) => ({ name, offBudget, closed, balance })),
      categoryMonths: expectedMonths.map((month) => {
        const category = liveCategories.find((candidate) => candidate.name === month.category)
        return {
          sources: journal.categories.filter((source) => source.categoryId === category?.id).map((source) => source.id),
          month: month.month,
          total: month.total,
        }
      }),
      budgets: [...budgetMonths].map(([name, months]) => ({
        name,
        hidden: liveCategories.find((category) => category.name === name)?.hidden ?? false,
        months,
      })),
    },
  }
}

describe('the recorded Actual Budget upload', () => {
  it('is what the import screen sends for the envelope export', async () => {
    const replay = await buildReplay()
    if (process.env.WRITE_ACTUAL_REPLAY) writeFileSync(REPLAY, `${JSON.stringify(replay, null, 1)}\n`)

    expect(replay.expected.categoryMonths.every((month) => month.sources.length > 0)).toBe(true)
    expect(JSON.parse(readFileSync(REPLAY, 'utf8'))).toEqual(replay)
  })
})
