// Presentation helpers for the runway widget. The compute itself lives in the
// backend (GET /me/runway) — these functions just format the months figure and
// classify it into one of three risk bands

export const RUNWAY_TARGET_MONTHS = 6
export const RUNWAY_THRESHOLD_MIN_MONTHS = 0
export const RUNWAY_THRESHOLD_MAX_MONTHS = 12
export const RUNWAY_THRESHOLD_STEP_MONTHS = 0.5
export const RUNWAY_THRESHOLD_MIN_SEPARATION_MONTHS = 2

export type RunwayBand = 'healthy' | 'low' | 'risky'

export type RunwayThresholds = {
  riskyBelowMonths: number
  healthyAtMonths: number
}

export const DEFAULT_RUNWAY_THRESHOLDS: RunwayThresholds = {
  riskyBelowMonths: 1,
  healthyAtMonths: 3,
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function roundRunwayThreshold(value: number) {
  return Math.round(value / RUNWAY_THRESHOLD_STEP_MONTHS) * RUNWAY_THRESHOLD_STEP_MONTHS
}

export function normalizeRunwayThresholds(thresholds: RunwayThresholds): RunwayThresholds {
  const riskyBelowMonths = clamp(
    roundRunwayThreshold(thresholds.riskyBelowMonths),
    RUNWAY_THRESHOLD_MIN_MONTHS,
    RUNWAY_THRESHOLD_MAX_MONTHS - RUNWAY_THRESHOLD_MIN_SEPARATION_MONTHS,
  )
  const healthyAtMonths = clamp(
    roundRunwayThreshold(thresholds.healthyAtMonths),
    riskyBelowMonths + RUNWAY_THRESHOLD_MIN_SEPARATION_MONTHS,
    RUNWAY_THRESHOLD_MAX_MONTHS,
  )

  return { riskyBelowMonths, healthyAtMonths }
}

export const RUNWAY_BAND_STYLE: Record<RunwayBand, { label: string; bg: string; fg: string }> = {
  healthy: { label: 'Healthy', bg: 'var(--app-positive-soft)', fg: 'var(--app-positive)' },
  low: { label: 'Low', bg: 'var(--app-accent-soft)', fg: 'var(--app-accent)' },
  risky: { label: 'Risky', bg: 'var(--app-negative-soft)', fg: 'var(--app-negative)' },
}

export function runwayBand(
  months: number | null,
  thresholds: RunwayThresholds = DEFAULT_RUNWAY_THRESHOLDS,
): RunwayBand | null {
  if (months === null) return null
  if (months >= thresholds.healthyAtMonths) return 'healthy'
  if (months >= thresholds.riskyBelowMonths) return 'low'
  return 'risky'
}

// Compact runway display. Prefixes with "≈" to signal that this is a rough
// projection from trailing-average expenses, not a precise prediction
// < 1 → "< 1 mth", 1–11 → "≈ 4 mths", 12–23 → "≈ 1 yr" / "≈ 1.5 yrs", ≥ 24 → "≈ N yrs"
export function formatCompactRunway(months: number | null): string {
  if (months === null || !Number.isFinite(months)) return 'N/A'
  if (months < 1) return '< 1 mth'
  if (months < 12) return `≈ ${Math.round(months)} mths`
  const years = months / 12
  if (months < 24) {
    // 12 → "1 yr", 18 → "1.5 yrs". Half-step resolution reads naturally here
    const rounded = Math.round(years * 2) / 2
    return `≈ ${rounded} ${rounded === 1 ? 'yr' : 'yrs'}`
  }
  return `≈ ${Math.floor(years)} yrs`
}

export function formatRunwayBasis(months: number): string {
  return `${months} ${months === 1 ? 'mth' : 'mths'} basis`
}
