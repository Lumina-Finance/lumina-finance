import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'

/** Filters owned by the global transaction page's address rather than its local draft state */
export type TransactionNavigationFilters = Pick<TransactionListFilters, 'category_id' | 'from_date' | 'to_date'>

const CATEGORY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Accepts a padded calendar day only when its year, month, and day really exist */
function isCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]
}

/** Reads valid category IDs and inclusive calendar bounds, omitting an impossible reversed range */
export function parseTransactionNavigationFilters(params: URLSearchParams): TransactionNavigationFilters {
  const categoryIds = [...new Set(params.getAll('category_id').filter((id) => CATEGORY_ID.test(id)).map((id) => id.toLowerCase()))]
  const from = params.get('from_date') ?? ''
  const to = params.get('to_date') ?? ''
  const filters: TransactionNavigationFilters = {}
  if (categoryIds.length > 0) filters.category_id = categoryIds
  if (isCalendarDate(from)) filters.from_date = from
  if (isCalendarDate(to)) filters.to_date = to
  if (filters.from_date && filters.to_date && filters.from_date > filters.to_date) {
    delete filters.from_date
    delete filters.to_date
  }
  return filters
}

/** Replaces only owned address fields, retaining every unrelated query value and its repetition */
export function writeTransactionNavigationFilters(params: URLSearchParams, filters: TransactionNavigationFilters): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const key of ['category_id', 'from_date', 'to_date']) next.delete(key)
  const owned = new URLSearchParams()
  for (const id of filters.category_id ?? []) owned.append('category_id', id)
  if (filters.from_date) owned.set('from_date', filters.from_date)
  if (filters.to_date) owned.set('to_date', filters.to_date)
  const valid = parseTransactionNavigationFilters(owned)
  for (const id of valid.category_id ?? []) next.append('category_id', id)
  if (valid.from_date) next.set('from_date', valid.from_date)
  if (valid.to_date) next.set('to_date', valid.to_date)
  return next
}

/** Builds a category drill-down without adding a sign or chart-mode restriction */
export function buildCategoryTransactionsUrl(categoryId: string, range: { from: string; to: string }): string {
  const params = writeTransactionNavigationFilters(new URLSearchParams(), { category_id: [categoryId], from_date: range.from, to_date: range.to })
  return `/transactions?${params}`
}
