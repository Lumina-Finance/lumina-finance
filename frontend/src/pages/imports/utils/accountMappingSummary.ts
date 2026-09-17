export interface AccountMappingSummaryCounts {
  selected: number
  mapped: number
  new: number
}

/**
 * Formats the account mapping counts shown above one mapping table
 */
export function formatAccountMappingSummary({
  selected,
  mapped,
  new: newCount,
}: AccountMappingSummaryCounts): string {
  return `${selected} selected · ${mapped} mapped · ${newCount} new`
}
