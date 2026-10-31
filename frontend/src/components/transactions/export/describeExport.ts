import type { TransactionListFilters } from '@/components/transactions/types/transactionList'
import { formatDateLabel, formatDateRangeLabel } from '@/utils/date'

/** Names for the ids a filter holds, read from what the page already loaded */
export type ExportNames = {
  accounts: ReadonlyMap<string, string>
  categories: ReadonlyMap<string, string>
  merchants: ReadonlyMap<string, string>
  tags: ReadonlyMap<string, string>
}

/** One kind of condition, with each choice by its name so a long list wraps one choice at a time */
export type ExportConditionGroup = { label: string; values: string[] }

export type ExportDescription = {
  /** Says what the file holds in a sentence, date range included */
  summary: string
  groups: ExportConditionGroup[]
}

/**
 * Says in plain words what the file will hold, from the same filters and search the export request is
 * built from
 *
 * Returns null while a chosen account, category, merchant or tag has no name yet, since the dialogue
 * never shows an id in its place
 *
 * @param formatAmount - Writes minor units in a currency as the user reads money
 */
export function describeExport({
  filters,
  search,
  names,
  formatAmount,
}: {
  filters: TransactionListFilters
  search: string
  names: ExportNames
  formatAmount: (minorUnits: number, currency: string) => string
}): ExportDescription | null {
  const groups: ExportConditionGroup[] = []
  const trimmedSearch = search.trim()
  if (trimmedSearch) groups.push({ label: 'Merchant or notes containing', values: [trimmedSearch] })

  const lookups = [
    { label: 'Accounts', ids: filters.account_id, known: names.accounts },
    { label: 'Category', ids: filters.category_id, known: names.categories },
    { label: 'Merchant', ids: filters.merchant_id, known: names.merchants },
    { label: getTagsLabel(filters), ids: filters.tag_id, known: names.tags },
  ]
  for (const { label, ids, known } of lookups) {
    if (!ids?.length) continue
    const values = ids.map((id) => known.get(id))
    if (values.some((value) => value === undefined)) return null
    groups.push({ label, values: values as string[] })
  }

  if (filters.currency) groups.push({ label: 'Currency', values: [filters.currency] })

  const amountText = describeAmountRange(filters, formatAmount)
  if (amountText) groups.push({ label: 'Amount', values: [amountText] })

  return { summary: buildSummary(filters, groups.length > 0), groups }
}

function getTagsLabel(filters: TransactionListFilters): string {
  if ((filters.tag_id?.length ?? 0) < 2) return 'Tag'
  return filters.tag_match === 'any' ? 'Tags, any one of them' : 'Tags, all of them'
}

function describeAmountRange(
  { min_amount, max_amount, amount_currency }: TransactionListFilters,
  formatAmount: (minorUnits: number, currency: string) => string,
): string | null {
  if (min_amount === undefined && max_amount === undefined) return null

  // The request always names the currency a bound is counted in, and the panel sets it with the bound
  const currency = amount_currency ?? ''
  const lower = min_amount === undefined ? null : formatAmount(min_amount, currency)
  const upper = max_amount === undefined ? null : formatAmount(max_amount, currency)
  const range =
    lower !== null && upper !== null
      ? `between ${lower} and ${upper}`
      : lower !== null
        ? `at least ${lower}`
        : `at most ${upper}`
  return `${range} ${currency}`.trim()
}

function buildSummary(filters: TransactionListFilters, hasConditions: boolean): string {
  const { from_date, to_date } = filters
  const dateClause =
    from_date && to_date
      ? ` dated ${formatDateRangeLabel(from_date, to_date)}`
      : from_date
        ? ` dated ${formatDateLabel(from_date)} or later`
        : to_date
          ? ` dated ${formatDateLabel(to_date)} or earlier`
          : ''
  const subject = hasConditions ? 'your transactions' : 'all your transactions'
  const conditionClause = hasConditions ? ' that match everything below' : ''
  const anyDateClause = dateClause === '' ? ', whatever their date' : ''
  const sentence = `The file will hold ${subject}${dateClause}${conditionClause}${anyDateClause}.`

  if (hasConditions) return sentence

  // The date range is a filter of the dialogue's own Filters button, which counts it, so the words
  // never say no filters are applied while a range is
  return dateClause === ''
    ? `${sentence} No search or filters are applied.`
    : `${sentence} No search or other filters are applied.`
}
