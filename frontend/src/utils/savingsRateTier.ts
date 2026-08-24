export type SavingsRateTier = 'positive' | 'accent' | 'negative'

/**
 * The three tiers in the order the legend lists them and the charts define their stripe patterns
 */
export const SAVINGS_RATE_TIERS = ['positive', 'accent', 'negative'] as const

// A month that keeps this share of its income or more reads as a strong result
const SAVINGS_RATE_POSITIVE_TIER_MIN_PERCENT = 20

// A month that keeps less than this reads the same as one that kept nothing at all
const SAVINGS_RATE_ACCENT_TIER_MIN_PERCENT = 10

const SAVINGS_RATE_TIER_COLORS: Record<SavingsRateTier, string> = {
  positive: 'var(--app-chart-positive)',
  accent: 'var(--app-accent)',
  negative: 'var(--app-chart-negative)',
}

/**
 * The band each tier covers, worded the way the legend shows it
 */
export const SAVINGS_RATE_TIER_LABELS: Record<SavingsRateTier, string> = {
  positive: `${SAVINGS_RATE_POSITIVE_TIER_MIN_PERCENT}%+`,
  accent: `${SAVINGS_RATE_ACCENT_TIER_MIN_PERCENT}-${SAVINGS_RATE_POSITIVE_TIER_MIN_PERCENT - 1}%`,
  negative: `Under ${SAVINGS_RATE_ACCENT_TIER_MIN_PERCENT}%`,
}

/**
 * Converts a savings rate into the tier every savings rate chart colours it by
 *
 * A month with no income and no expenses has no rate to place and takes the lowest tier. Neither
 * chart draws a bar for such a month, so the tier it holds is never painted
 */
export function getSavingsRateTier(rate: number | null): SavingsRateTier {
  if (rate === null) return 'negative'
  if (rate >= SAVINGS_RATE_POSITIVE_TIER_MIN_PERCENT) return 'positive'
  if (rate >= SAVINGS_RATE_ACCENT_TIER_MIN_PERCENT) return 'accent'
  return 'negative'
}

/**
 * Resolves the colour a tier is drawn in, the same shade in both themes
 */
export function getSavingsRateTierColor(tier: SavingsRateTier) {
  return SAVINGS_RATE_TIER_COLORS[tier]
}
