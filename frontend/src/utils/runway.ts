// Presentation helpers for the runway widget. The compute itself lives in the
// backend (GET /me/runway) — these functions just format the months figure and
// classify it into one of three risk bands

// Imported from the domain's types module rather than its index, because the index reaches
// api/user/mappers, which imports normalizeRunwayThresholds from here. The edge is type-only and
// erased at build, so this avoids writing a source-level cycle for no gain
import type { RunwayThresholds } from '@/api/user/types'

export const RUNWAY_TARGET_MONTHS = 6
export const RUNWAY_THRESHOLD_MIN_MONTHS = 0
export const RUNWAY_THRESHOLD_MAX_MONTHS = 12
export const RUNWAY_THRESHOLD_STEP_MONTHS = 0.5
export const RUNWAY_THRESHOLD_MIN_SEPARATION_MONTHS = 2

export type RunwayBand = 'healthy' | 'low' | 'risky'

export const DEFAULT_RUNWAY_THRESHOLDS: RunwayThresholds = {
  riskyBelowMonths: 1,
  healthyAtMonths: 3,
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function roundRunwayThreshold(value: number) {
  return Math.round(value / RUNWAY_THRESHOLD_STEP_MONTHS) * RUNWAY_THRESHOLD_STEP_MONTHS
}

/**
 * Snaps a user's chosen runway thresholds to the nearest half month and holds them inside the range
 * the sliders allow
 *
 * The healthy threshold is raised where it needs to be so it always sits at least two months above the
 * risky one, which stops the low band collapsing when both are dragged together
 */
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

/**
 * Sorts a runway in months into the healthy, low or risky band the widget colours itself from
 *
 * A missing runway stays missing instead of falling into the risky band, so the widget can show an
 * empty state rather than an alarming one
 */
export function runwayBand(
  months: number | null,
  thresholds: RunwayThresholds = DEFAULT_RUNWAY_THRESHOLDS,
): RunwayBand | null {
  if (months === null) return null
  if (months >= thresholds.healthyAtMonths) return 'healthy'
  if (months >= thresholds.riskyBelowMonths) return 'low'
  return 'risky'
}

/**
 * Formats a runway in months for compact display, reading as "< 1 mth", "≈ 4 mths", "≈ 1.5 yrs" or
 * "≈ 9 yrs"
 *
 * The "≈" marks this as a rough projection from trailing-average expenses rather than a precise
 * prediction, and a missing or non-finite figure reads as "N/A"
 */
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

/**
 * Labels the trailing window a runway estimate was calculated over, reading as "3 mths basis"
 */
export function formatRunwayBasis(months: number): string {
  return `${months} ${months === 1 ? 'mth' : 'mths'} basis`
}
