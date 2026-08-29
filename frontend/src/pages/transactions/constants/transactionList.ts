import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'

export const DEFAULT_TRANSACTION_CATEGORY_ICON = '🏷️'

export const TRANSACTION_FILTER_KEYS: Array<keyof TransactionListFilters> = [
  'account_id',
  'category_id',
  'merchant_id',
  'tag_id',
  'tag_match',
  'currency',
  'min_amount',
  'max_amount',
  'amount_currency',
  'from_date',
  'to_date',
]

export const FILTER_LIST_LOADING_MIN_MS = 1000
export const TRANSACTION_LIST_EASE = [0.25, 0.1, 0.25, 1] as const

// The room the checkbox sits in while the list is in selection mode. Held as padding on the list
// rather than as a column, because a column the list declares in both states still takes a column
// gap at zero width, and every row outside selection mode would lose that much space and start
// truncating text it fits today
export const TRANSACTION_CHECKBOX_RAIL_WIDTH = '2.5rem'

// Set on the list while selection mode opens and closes, and read by the rows and date headings
export const TRANSACTION_CHECKBOX_RAIL_VARIABLE = '--transaction-checkbox-rail' as const

// Falls back to zero for the import preview, which renders the same row outside this list
export const TRANSACTION_CHECKBOX_RAIL = `var(${TRANSACTION_CHECKBOX_RAIL_VARIABLE}, 0rem)`

// How long the rail takes to open and close, matched by the checkbox fading in and out inside it
export const TRANSACTION_CHECKBOX_RAIL_DURATION_S = 0.22

// Given to every row and date heading, so their backgrounds and separators still run the full width
// of the list while their cells stay on the tracks it declares. The negative margin reaches the box
// back across the rail and the width puts back what the margin took
export const REACHES_ACROSS_TRANSACTION_CHECKBOX_RAIL = {
  marginLeft: `calc(-1 * ${TRANSACTION_CHECKBOX_RAIL})`,
  width: `calc(100% + ${TRANSACTION_CHECKBOX_RAIL})`,
}
