import type { CreditWidgetResponse } from '@/api/dashboard'

export type CreditMode = 'used' | 'available'

export type CreditUsageSummary = {
  creditLimit: number
  creditUsed: number
  creditAvailable: number
  creditRemaining: number
  utilization: number
  remainingPct: number
  displayPct: number
  displayAmount: number
  hasCredit: boolean
  tier: CreditUsageTier
  tierColor: string
  tierSoft: string
}

type CreditUsageTier = 'positive' | 'accent' | 'negative'

/**
 * Converts utilization into the visual risk tier used by the credit widget
 */
function getCreditUsageTier(utilization: number): CreditUsageTier {
  if (utilization <= 30) return 'positive'
  if (utilization <= 70) return 'accent'
  return 'negative'
}

/**
 * Derives credit utilization, remaining credit, and display values for the active credit mode
 */
export function getCreditUsageSummary(
  dashboardCredit: CreditWidgetResponse | undefined,
  creditMode: CreditMode,
): CreditUsageSummary {
  const creditLimit = dashboardCredit?.credit_limit_total ?? 0
  const creditUsed = dashboardCredit?.credit_used ?? 0
  const utilization = creditLimit > 0 ? Math.round((creditUsed / creditLimit) * 100) : 0
  const hasCredit = creditLimit > 0
  const creditAvailable = creditLimit
  const creditRemaining = creditAvailable - creditUsed
  const remainingPct = creditAvailable > 0 ? 100 - utilization : 0
  const displayPct = creditMode === 'used' ? utilization : remainingPct
  const displayAmount = creditMode === 'used' ? creditUsed : creditRemaining
  const tier = getCreditUsageTier(utilization)

  return {
    creditLimit,
    creditUsed,
    creditAvailable,
    creditRemaining,
    utilization,
    remainingPct,
    displayPct,
    displayAmount,
    hasCredit,
    tier,
    tierColor: `var(--app-${tier})`,
    tierSoft: `var(--app-${tier}-soft)`,
  }
}
