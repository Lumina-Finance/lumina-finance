import { matchQuery, type Query, type QueryKey } from '@tanstack/react-query'
import {
  accountKeys,
  budgetKeys,
  categoryKeys,
  dashboardKeys,
  importLayoutKeys,
  importSourceKeys,
  insightsKeys,
  institutionKeys,
  merchantKeys,
  tagKeys,
  taxAdvantagedCategoryKeys,
  transactionKeys,
  transactionOverviewKeys,
  userKeys,
} from '@/api/cache/queryKeys'

/**
 * A family of covered queries: every key that starts with `queryKey`
 *
 * `dependsOnDate` says whether the server's answer, or the screen built from it, changes with the
 * user's current date even when no data changed: balances as of today, periods and windows that end
 * today, rankings aged by today. A new day alone refetches only these. Mark a family `true` whenever
 * unsure, since a wrongly marked `false` shows yesterday's figures until something else changes
 */
type CoveredQuery = {
  queryKey: QueryKey
  dependsOnDate: boolean
}

/**
 * The queries whose answers the change check covers: a restored answer fetched since the check last
 * found a difference is still current when the check finds none, so the app asks the server nothing
 * more for it on opening
 *
 * Left out on purpose, and fetched as before: the last import and import runs, bank sync data (each
 * account's link status, the connections, the providers, the link list, the review inbox and its
 * backlogs, the pending rows and the holds), the two-step sign-in and passkeys, provider settings,
 * and the app version. Their changes are not all recorded by the markers the check compares, and the
 * bank data's stale time is zero, so a screen reads it again whenever it mounts however recent the
 * restored answer looks
 */
export const COVERED_QUERIES: readonly CoveredQuery[] = [
  // Current balances, the later-transaction flag and snapshots up to today
  { queryKey: accountKeys.all, dependsOnDate: true },

  // Lists and details read as stored, each amount converted at the rate of its own date
  { queryKey: transactionKeys.all, dependsOnDate: false },

  // Calculated amounts count transactions up to today
  { queryKey: transactionOverviewKeys.all, dependsOnDate: true },

  // Limits and contributions are worked out for the owner's current year
  { queryKey: taxAdvantagedCategoryKeys.all, dependsOnDate: true },

  // Budget periods, the latest period of each budget and its utilization follow today
  { queryKey: budgetKeys.all, dependsOnDate: true },

  // Every dashboard widget reads a window or period that ends today, or today's balances
  { queryKey: dashboardKeys.netWorthAll, dependsOnDate: true },
  { queryKey: dashboardKeys.credit(), dependsOnDate: true },
  { queryKey: dashboardKeys.creditUtilization(), dependsOnDate: true },
  { queryKey: dashboardKeys.recentActivityAll, dependsOnDate: true },
  { queryKey: dashboardKeys.savingsRateAll, dependsOnDate: true },
  { queryKey: dashboardKeys.spendingComparisonAll, dependsOnDate: true },
  { queryKey: dashboardKeys.spendingBreakdownAll, dependsOnDate: true },

  // Every insights answer stops at today, however far ahead the range reaches
  { queryKey: insightsKeys.periodGlanceAll, dependsOnDate: true },
  { queryKey: insightsKeys.fundFlowAll, dependsOnDate: true },
  { queryKey: insightsKeys.incomeExpenseBreakdownAll, dependsOnDate: true },
  { queryKey: insightsKeys.cashFlowAll, dependsOnDate: true },
  { queryKey: insightsKeys.netWorthAll, dependsOnDate: true },
  { queryKey: insightsKeys.savingsRateTrendAll, dependsOnDate: true },
  { queryKey: insightsKeys.merchantsAll, dependsOnDate: true },

  // A saved range stores how it is anchored, and the screen works the dates out
  { queryKey: insightsKeys.savedRanges(), dependsOnDate: false },

  // Only the account selection and the status thresholds
  { queryKey: userKeys.runwayAccounts(), dependsOnDate: false },
  { queryKey: userKeys.runwaySettings(), dependsOnDate: false },

  // Balances as of today and the spending window that ends before this month
  { queryKey: userKeys.runway(), dependsOnDate: true },
  { queryKey: categoryKeys.list(), dependsOnDate: false },

  // The server ranks merchants by how recently each was used, aged against today
  { queryKey: merchantKeys.all, dependsOnDate: true },
  { queryKey: tagKeys.all, dependsOnDate: false },
  { queryKey: institutionKeys.list(), dependsOnDate: false },
  { queryKey: importLayoutKeys.all, dependsOnDate: false },
  { queryKey: importSourceKeys.all, dependsOnDate: false },
]

/**
 * Whether the change check covers a query's answer
 */
export function isCoveredQuery(query: Query) {
  return COVERED_QUERIES.some(({ queryKey }) => matchQuery({ queryKey }, query))
}

/**
 * Whether a query is covered and its family depends on the current date, so a new day alone makes
 * its answer stale
 */
export function isDateDependentQuery(query: Query) {
  return COVERED_QUERIES.some(({ queryKey, dependsOnDate }) => dependsOnDate && matchQuery({ queryKey }, query))
}
