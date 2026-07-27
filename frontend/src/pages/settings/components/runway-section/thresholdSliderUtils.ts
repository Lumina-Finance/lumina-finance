import {
  RUNWAY_BAND_STYLE,
  RUNWAY_THRESHOLD_MAX_MONTHS,
  RUNWAY_THRESHOLD_MIN_MONTHS,
  clamp,
} from '@/utils/runway'

/**
 * Formats threshold month counts with the compact label used by the runway control
 */
export function formatThresholdMonths(value: number) {
  const label = Number.isInteger(value) ? String(value) : value.toFixed(1)

  return `${label} ${value === 1 ? 'mth' : 'mths'}`
}

/**
 * Converts a month value into its percentage position along the threshold slider's configured
 * range
 */
export function thresholdPct(value: number) {
  const range = RUNWAY_THRESHOLD_MAX_MONTHS - RUNWAY_THRESHOLD_MIN_MONTHS

  return ((value - RUNWAY_THRESHOLD_MIN_MONTHS) / range) * 100
}

/**
 * Converts a pointer coordinate into the corresponding month value on the slider rail
 */
export function thresholdFromRailPoint(clientX: number, rail: HTMLDivElement | null) {
  if (!rail) return null
  const { left, width } = rail.getBoundingClientRect()
  if (width <= 0) return null

  const pct = clamp((clientX - left) / width, 0, 1)
  const range = RUNWAY_THRESHOLD_MAX_MONTHS - RUNWAY_THRESHOLD_MIN_MONTHS

  return RUNWAY_THRESHOLD_MIN_MONTHS + pct * range
}

/**
 * Builds a softened three-band track gradient around the two editable thresholds
 */
export function getRunwayThresholdGradient(riskyPct: number, healthyPct: number) {
  const blendPct = thresholdPct(1)
  const riskyBlendStart = Math.max(0, riskyPct - blendPct)
  const riskyBlendEnd = Math.min(healthyPct, riskyPct + blendPct)
  const healthyBlendStart = Math.max(riskyPct, healthyPct - blendPct)
  const healthyBlendEnd = Math.min(100, healthyPct + blendPct)
  const riskyFill = runwayTrackColor('risky')
  const lowFill = runwayTrackColor('low')
  const healthyFill = runwayTrackColor('healthy')

  return `linear-gradient(90deg,
    ${riskyFill} 0%,
    ${riskyFill} ${riskyBlendStart}%,
    ${lowFill} ${riskyBlendEnd}%,
    ${lowFill} ${healthyBlendStart}%,
    ${healthyFill} ${healthyBlendEnd}%,
    ${healthyFill} 100%)`
}

function runwayTrackColor(band: keyof typeof RUNWAY_BAND_STYLE) {
  return `color-mix(in srgb, ${RUNWAY_BAND_STYLE[band].fg} 38%, var(--app-input-bg))`
}
