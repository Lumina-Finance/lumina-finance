// Presentation helpers for the runway widget. The compute itself lives in the
// backend (GET /me/runway) — these functions just format the months figure and
// classify it into one of three risk bands.

export const RUNWAY_TARGET_MONTHS = 6

export type RunwayBand = 'healthy' | 'watch' | 'low'

export const RUNWAY_BAND_STYLE: Record<RunwayBand, { label: string; bg: string; fg: string }> = {
  healthy: { label: 'Healthy', bg: 'var(--app-positive-soft)', fg: 'var(--app-positive)' },
  watch: { label: 'Watch', bg: 'var(--app-accent-soft)', fg: 'var(--app-accent)' },
  low: { label: 'Low', bg: 'var(--app-negative-soft)', fg: 'var(--app-negative)' },
}

export function runwayBand(months: number | null): RunwayBand | null {
  if (months === null) return null
  if (months >= 3) return 'healthy'
  if (months >= 1) return 'watch'
  return 'low'
}

// Compact runway display.
// < 1 → "< 1 mth", 1–11 → "4 mths", 12–23 → "1 yr" / "1.5 yrs", ≥ 24 → whole years.
export function formatCompactRunway(months: number | null): string {
  if (months === null || !Number.isFinite(months)) return 'N/A'
  if (months < 1) return '< 1 mth'
  if (months < 12) return `${Math.round(months)} mths`
  const years = months / 12
  if (months < 24) {
    // 12 → "1 yr", 18 → "1.5 yrs". Half-step resolution reads naturally here.
    const rounded = Math.round(years * 2) / 2
    return `${rounded} ${rounded === 1 ? 'yr' : 'yrs'}`
  }
  return `${Math.floor(years)} yrs`
}
