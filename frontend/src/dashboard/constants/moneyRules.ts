import type {
  CompactMoneyRule,
  DashboardMoneyFormat,
} from '@/dashboard/types/dashboard'

// Money compaction is intentionally widget-specific: net worth tolerates more
// precision at large values, while compact cards need earlier K/M shortening.
export const DASHBOARD_MONEY_RULES: Record<DashboardMoneyFormat, CompactMoneyRule[]> = {
  raw: [],
  netWorth: [
    { threshold: 100_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 0 },
    { threshold: 10_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 1 },
    { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 2 },
  ],
  credit: [
    { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 0 },
    { threshold: 100_000, divisor: 1_000, suffix: 'K', fractionDigits: 0 },
  ],
  breakdown: [
    { threshold: 100_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 0 },
    { threshold: 10_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 1 },
    { threshold: 1_000_000, divisor: 1_000_000, suffix: 'M', fractionDigits: 2 },
    { threshold: 100_000, divisor: 1_000, suffix: 'K', fractionDigits: 0, rounding: 'ceil' },
    { threshold: 10_000, divisor: 1_000, suffix: 'K', fractionDigits: 1, rounding: 'ceil' },
    { threshold: 1_000, divisor: 1_000, suffix: 'K', fractionDigits: 0, rounding: 'ceil' },
  ],
}
