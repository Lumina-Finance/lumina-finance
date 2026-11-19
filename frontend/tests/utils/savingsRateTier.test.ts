/**
 * Tests the savings rate tier scale, so both charts place a rate in the same band, a better rate never
 * shows a worse band, each band is painted the same colour, and the legend moves with the thresholds
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  getSavingsRateTier,
  SAVINGS_RATE_TIER_LABELS,
  SAVINGS_RATE_TIERS,
  type SavingsRateTier,
} from '@/utils/savingsRateTier'

const WHOLE_RATES_FROM_MINUS_100_TO_100 = Array.from({ length: 201 }, (_, index) => index - 100)

// Enough rates in one draw that several land on each side of every threshold
const MAX_RATES_COMPARED = 50

// Most draws are tenths of a percent from -100% to 100%, where the thresholds sit, as in 19.9%, and
// the rest anywhere a rate could reach, infinities included
const savingsRates = fc.oneof(
  { arbitrary: fc.integer({ min: -1000, max: 1000 }).map((tenths) => tenths / 10), weight: 4 },
  { arbitrary: fc.double({ noNaN: true }), weight: 1 },
)

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
    expect(getSavingsRateTier(20)).toBe('positive')
    expect(getSavingsRateTier(19.9)).toBe('accent')
    expect(getSavingsRateTier(19)).toBe('accent')
    expect(getSavingsRateTier(10)).toBe('accent')
    expect(getSavingsRateTier(9)).toBe('negative')
  })

  it('never places a higher rate in a lower band', () => {
    // The tiers are listed from the highest down, so a higher band has a lower position in the list
    const getBandRank = (rate: number) => SAVINGS_RATE_TIERS.indexOf(getSavingsRateTier(rate))

    fc.assert(
      fc.property(fc.array(savingsRates, { minLength: 2, maxLength: MAX_RATES_COMPARED }), (rates) => {
        const ranks = rates.toSorted((a, b) => a - b).map(getBandRank)

        expect(ranks).toStrictEqual(ranks.toSorted((a, b) => b - a))
      }),
    )
  })

  it('places a month with no rate and a month of pure spending in the lowest band', () => {
    // A null rate only reaches this guard while both thresholds sit above zero, since null >= 0 is
    // true and a threshold lowered to zero would otherwise paint a month with no activity amber
    expect(getSavingsRateTier(null)).toBe('negative')
    expect(getSavingsRateTier(Number.NEGATIVE_INFINITY)).toBe('negative')
    expect(getSavingsRateTier(Number.POSITIVE_INFINITY)).toBe('positive')
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
