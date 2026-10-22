import type { DashboardMoneyFormat } from '@/pages/dashboard/types/dashboard'
import type { CompactMoneyRule } from '@/utils/formatCompactMoney'

// Money compaction is intentionally widget-specific: net worth compacts later than the compact
// cards, which need earlier K/M shortening. Every compacted amount keeps one decimal, even a zero
// one, so figures side by side line up. An amount below a widget's smallest threshold shows in full,
// cents included, which is deliberate: $99,999.99 sits beside "of ≈$200.0K" in the credit widget
export const DASHBOARD_MONEY_RULES: Record<DashboardMoneyFormat, CompactMoneyRule[]> = {
  raw: [],
  netWorth: [
    { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 1 },
  ],
  credit: [
    { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 1 },
    { threshold: 100_000, divisor: 1_000, suffix: 'K', fractionDigits: 1 },
  ],
  breakdown: [
    { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 1 },
    { threshold: 1_000, divisor: 1_000, suffix: 'K', fractionDigits: 1 },
  ],
}
