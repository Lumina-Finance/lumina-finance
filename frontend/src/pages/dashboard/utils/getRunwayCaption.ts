import type { RunwayResult } from '@/api/user'
import type { Currency } from '@/api/currency'
import { formatCurrency } from '@/utils/formatCurrency'
import { formatRunwayBasis } from '@/utils/runway'

/**
 * Builds the runway caption for setup, history, and active runway states
 */
export function getRunwayCaption(
  runway: RunwayResult | undefined,
  displayCurrency: string,
  currencies: Currency[],
) {
  if (!runway) return ''

  if (runway.reason === 'no_accounts') return 'Choose accounts in Settings'
  if (runway.reason === 'insufficient_history') return 'Need 1+ month of net expense data'

  return `${formatCurrency(runway.avg_monthly_expense, displayCurrency, currencies)}/mth \u00B7 ${formatRunwayBasis(runway.months_covered)}`
}
