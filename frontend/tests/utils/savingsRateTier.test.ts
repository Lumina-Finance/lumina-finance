/**
 * Tests the savings rate tier scale, so both charts place a rate in the same band, paint that band
 * the same colour, and describe it in a legend that moves with the thresholds
 */
import { describe, expect, it } from 'vitest'
import {
  getSavingsRateTier,
  getSavingsRateTierColor,
  SAVINGS_RATE_TIER_LABELS,
  SAVINGS_RATE_TIERS,
  type SavingsRateTier,
} from '@/utils/savingsRateTier'

const WHOLE_RATES_FROM_MINUS_100_TO_100 = Array.from({ length: 201 }, (_, index) => index - 100)

/**
 * Finds the lowest whole rate the tier function puts in a band, by asking it about every rate
 *
 * The labels are checked against this rather than against the thresholds the module holds, since a
 * label typed out by hand matches those thresholds until one of them moves, which is the day the
 * label is wrong and the only day the check is worth anything
 */
function getLowestRateInTier(tier: SavingsRateTier) {
  const rate = WHOLE_RATES_FROM_MINUS_100_TO_100.find((candidate) => getSavingsRateTier(candidate) === tier)
  if (rate === undefined) throw new Error(`no whole rate between -100 and 100 falls in the ${tier} band`)

  return rate
}

describe('savings rate tiers', () => {
  it('places a rate in one band on both sides of each threshold', () => {
    expect(getSavingsRateTier(25)).toBe('positive')
    expect(getSavingsRateTier(20)).toBe('positive')
    expect(getSavingsRateTier(19)).toBe('accent')
    expect(getSavingsRateTier(10)).toBe('accent')
    expect(getSavingsRateTier(9)).toBe('negative')
    expect(getSavingsRateTier(5)).toBe('negative')
    expect(getSavingsRateTier(0)).toBe('negative')
    expect(getSavingsRateTier(-100)).toBe('negative')
  })

  it('places a month with no rate and a month of pure spending in the lowest band', () => {
    // A null rate only reaches this guard while both thresholds sit above zero, since null >= 0 is
    // true and a threshold lowered to zero would otherwise paint a month with no activity amber
    expect(getSavingsRateTier(null)).toBe('negative')
    expect(getSavingsRateTier(Number.NEGATIVE_INFINITY)).toBe('negative')
    expect(getSavingsRateTier(Number.POSITIVE_INFINITY)).toBe('positive')
  })

  it('paints each band its own colour', () => {
    expect(getSavingsRateTierColor('positive')).toBe('var(--app-chart-positive)')
    expect(getSavingsRateTierColor('accent')).toBe('var(--app-accent)')
    expect(getSavingsRateTierColor('negative')).toBe('var(--app-chart-negative)')
  })

  it('lists the bands from the highest down, which is the order the legend and the stripes follow', () => {
    expect(SAVINGS_RATE_TIERS).toEqual(['positive', 'accent', 'negative'])
  })

  it('words each legend label from the band the tier function actually applies', () => {
    const lowestPositiveRate = getLowestRateInTier('positive')
    const lowestAccentRate = getLowestRateInTier('accent')

    expect(SAVINGS_RATE_TIER_LABELS.positive).toBe(`${lowestPositiveRate}%+`)
    expect(SAVINGS_RATE_TIER_LABELS.accent).toBe(`${lowestAccentRate}-${lowestPositiveRate - 1}%`)
    expect(SAVINGS_RATE_TIER_LABELS.negative).toBe(`Under ${lowestAccentRate}%`)
  })
})
