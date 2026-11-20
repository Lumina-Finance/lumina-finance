/**
 * Guards which answers the change check covers, and that every covered family says whether it depends
 * on today's date, so a screen added to the list can't skip being refetched on a new day by omission
 */
import { describe, expect, it } from 'vitest'
import { COVERED_QUERIES, isCoveredQuery, isDateDependentQuery } from '@/api/cache/coveredQueries'
import {
  accountKeys,
  appVersionKeys,
  bankSyncKeys,
  budgetKeys,
  categoryKeys,
  dashboardKeys,
  heldBankTransactionKeys,
  importLayoutKeys,
  importSourceKeys,
  insightsKeys,
  institutionKeys,
  lastImportKeys,
  merchantKeys,
  oidcKeys,
  passkeyKeys,
  tagKeys,
  taxAdvantagedCategoryKeys,
  transactionKeys,
  transactionOverviewKeys,
  twoFactorKeys,
  userKeys,
} from '@/api/cache/queryKeys'

const covered = (queryKey: readonly unknown[]) => isCoveredQuery({ queryKey } as Parameters<typeof isCoveredQuery>[0])

describe('which answers the change check covers', () => {
  it.each([
    ['an account and its snapshots', accountKeys.snapshots('account-1', { fromDate: '2026-01-01' })],
    ['a transaction list', transactionKeys.list({ page: 1 })],
    ['a budget period', budgetKeys.periods()],
    ['a dashboard widget', dashboardKeys.netWorth(30)],
    ['an insights card', insightsKeys.merchants('2026-01-01', '2026-01-31')],
    ['the runway', userKeys.runway()],
    ['the categories', categoryKeys.list()],
    ['a merchant lookup', merchantKeys.infinite({ search: 'a' }, 20)],
    ['the tags', tagKeys.infinite({}, 20)],
    ['the institutions', institutionKeys.infinite({}, 20)],
    ['the saved insight range pages', insightsKeys.savedRangesPages(20)],
    ['the import layouts', importLayoutKeys.all],
    ['the import sources', importSourceKeys.all],
    ['the saved insight ranges', insightsKeys.savedRanges()],
    ['a tax-advantaged category', taxAdvantagedCategoryKeys.limits('category-1')],
    ['a transactions overview', transactionOverviewKeys.detail({})],
  ])('covers %s', (_name, key) => {
    expect(covered(key)).toBe(true)
  })

  it.each([
    ['the last import', lastImportKeys.run('run-1')],
    ['an account link status', bankSyncKeys.accountStatus('account-1')],
    ['the bank connections', bankSyncKeys.connections()],
    ['the bank providers', bankSyncKeys.providers()],
    ['the bank link list', bankSyncKeys.links()],
    ['the bank sync review inbox', bankSyncKeys.reviewItems(undefined)],
    ['the bank sync review backlogs', bankSyncKeys.reviewBacklogs(undefined)],
    ['the bank sync pending strip', bankSyncKeys.pending(undefined)],
    ['the bank holds', bankSyncKeys.holds(undefined)],
    ['the two-step sign-in status', twoFactorKeys.status()],
    ['the passkeys', passkeyKeys.list()],
    ['the sign-in providers', oidcKeys.providers()],
    ['the app version', appVersionKeys.version()],
    ['the held bank transactions check', heldBankTransactionKeys.check({ fileIds: [], statements: [] })],
    ['a key the list does not name', ['something-new']],
  ])('leaves out %s, which is fetched as before', (_name, key) => {
    expect(covered(key)).toBe(false)
  })
})

const dependsOnDate = (queryKey: readonly unknown[]) =>
  isDateDependentQuery({ queryKey } as Parameters<typeof isDateDependentQuery>[0])

// One row per covered family, so adding a family without deciding its marking here fails the count below
const MARKINGS: Array<[name: string, key: readonly unknown[], dependsOnDate: boolean]> = [
  ['the accounts', accountKeys.detail('account-1'), true],
  ['the transactions', transactionKeys.list({ page: 1 }), false],
  ['a transactions overview', transactionOverviewKeys.detail({}), true],
  ['a tax-advantaged category', taxAdvantagedCategoryKeys.limits('category-1'), true],
  ['the budgets', budgetKeys.periods(), true],
  ['the net worth widget', dashboardKeys.netWorth(30), true],
  ['the credit widget', dashboardKeys.credit(), true],
  ['the credit utilization widget', dashboardKeys.creditUtilization(), true],
  ['the recent activity widget', dashboardKeys.recentActivity(30), true],
  ['the savings rate widget', dashboardKeys.savingsRate(), true],
  ['the spending comparison widget', dashboardKeys.spendingComparison('month'), true],
  ['the spending breakdown widget', dashboardKeys.spendingBreakdown('month'), true],
  ['the insights period glance', insightsKeys.periodGlance('2026-01-01', '2026-01-31'), true],
  ['the insights fund flow', insightsKeys.fundFlow('2026-01-01', '2026-01-31'), true],
  ['the insights income and expense breakdown', insightsKeys.incomeExpenseBreakdown('2026-01-01', '2026-01-31'), true],
  ['the insights cash flow', insightsKeys.cashFlow('2026-01-01', '2026-01-31'), true],
  ['the insights net worth', insightsKeys.netWorth('2026-01-01', '2026-01-31'), true],
  ['the insights savings rate trend', insightsKeys.savingsRateTrend(), true],
  ['the insights merchants', insightsKeys.merchants('2026-01-01', '2026-01-31'), true],
  ['the saved insight ranges', insightsKeys.savedRanges(), false],
  ['the runway accounts', userKeys.runwayAccounts(), false],
  ['the runway settings', userKeys.runwaySettings(), false],
  ['the runway', userKeys.runway(), true],
  ['the categories', categoryKeys.list(), false],
  ['the merchant ranking', merchantKeys.infinite({}, 20), true],
  ['the tags', tagKeys.infinite({}, 20), false],
  ['the institutions', institutionKeys.infinite({}, 20), false],
  ['the import layouts', importLayoutKeys.all, false],
  ['the import sources', importSourceKeys.all, false],
]

describe('which covered answers depend on today', () => {
  it('has a row for every covered family, each with a marking, so none is left to a default', () => {
    expect(MARKINGS).toHaveLength(COVERED_QUERIES.length)
    for (const family of COVERED_QUERIES) {
      expect(typeof family.dependsOnDate, `the family ${JSON.stringify(family.queryKey)}`).toBe('boolean')
    }
  })

  it.each(MARKINGS)('marks %s as depending on the date: %j', (_name, key, expected) => {
    expect(covered(key)).toBe(true)
    expect(dependsOnDate(key)).toBe(expected)
  })

  it('does not mark an answer the check leaves out', () => {
    expect(dependsOnDate(['something-new'])).toBe(false)
  })
})
