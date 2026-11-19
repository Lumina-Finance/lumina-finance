/**
 * Covers how a runway in months is written, so a rough figure never promises more time than there is,
 * and how the thresholds that sort a runway into bands are settled, so no choice of sliders leaves the
 * low band empty or the bands out of order
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { formatCompactRunway, normalizeRunwayThresholds } from '@/utils/runway'

// The rules the sliders keep, written out here so a constant that drifts in the app fails the properties
const MIN_MONTHS = 0
const MAX_MONTHS = 12
const STEP_MONTHS = 0.5
const MIN_GAP_MONTHS = 2

// Any pair a slider, a saved setting or a server answer could hold, far outside the range the sliders allow
const chosenThresholds = fc.record({
  riskyBelowMonths: fc.double({ noNaN: true, min: -1000, max: 1000 }),
  healthyAtMonths: fc.double({ noNaN: true, min: -1000, max: 1000 }),
})

describe('compact runway', () => {
  it('rounds months down', () => {
    expect(formatCompactRunway(4.9)).toBe('≈ 4 mths')
  })

  it('rounds a year and a half down to the half year', () => {
    expect(formatCompactRunway(23.9)).toBe('≈ 1.5 yrs')
  })

  it('rounds longer runways down to the year', () => {
    expect(formatCompactRunway(35.9)).toBe('≈ 2 yrs')
  })
})

describe('settling runway thresholds', () => {
  it('changes nothing when settled a second time', () => {
    fc.assert(
      fc.property(chosenThresholds, (thresholds) => {
        const settled = normalizeRunwayThresholds(thresholds)

        expect(normalizeRunwayThresholds(settled)).toStrictEqual(settled)
      }),
    )
  })

  it('keeps healthy at least two months above risky, both on half months inside the range the sliders allow', () => {
    fc.assert(
      fc.property(chosenThresholds, (thresholds) => {
        const { riskyBelowMonths, healthyAtMonths } = normalizeRunwayThresholds(thresholds)

        expect(healthyAtMonths - riskyBelowMonths).toBeGreaterThanOrEqual(MIN_GAP_MONTHS)
        expect(riskyBelowMonths).toBeGreaterThanOrEqual(MIN_MONTHS)
        expect(healthyAtMonths).toBeLessThanOrEqual(MAX_MONTHS)
        expect(riskyBelowMonths % STEP_MONTHS).toBe(0)
        expect(healthyAtMonths % STEP_MONTHS).toBe(0)
      }),
    )
  })

  it('settles a risky threshold inside the range to the nearest half month', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, min: MIN_MONTHS, max: MAX_MONTHS - MIN_GAP_MONTHS }), (riskyBelowMonths) => {
        const settled = normalizeRunwayThresholds({ riskyBelowMonths, healthyAtMonths: MAX_MONTHS })

        expect(Math.abs(settled.riskyBelowMonths - riskyBelowMonths)).toBeLessThanOrEqual(STEP_MONTHS / 2)
      }),
    )
  })
})
