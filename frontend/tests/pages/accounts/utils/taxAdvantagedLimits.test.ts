/**
 * Tests the tax-advantaged limit helpers, so the usage percentages, meter labels and plan summaries
 * cannot drift from the contribution room recorded against each plan, including a meter amount that
 * rounds up to a million reading CA$1M rather than CA$1,000K, and a meter drawn past full or under
 * empty, or saying over when the used amount is within the limit
 *
 * A currency's symbol is written the reader's way, so the amounts below assume the region the suite
 * pins through LC_ALL in its package script: read from the United States, where US dollars are the
 * plain ones and Canadian dollars are marked CA$
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { getFilteredRows } from '@/pages/accounts/utils/filters'
import {
  formatTaxAdvantagedMeterMoney,
  getLifetimeAvailableBoundary,
  getTaxAdvantagedMeterLabels,
  getTaxAdvantagedUsageLabelPercent,
  getTaxAdvantagedLimitSummaries,
  getTaxAdvantagedUsageColor,
  getTaxAdvantagedUsagePercent,
  hasTaxAdvantagedLimitTracking,
  getTaxAdvantagedUsageBarColor,
} from '@/pages/accounts/utils/taxAdvantagedLimits'
import { signedMinorUnits } from '@tests/utils/generators'
import { createAccount, createInstitution, createTaxAdvantagedCategory, testCurrencies } from './fixtures'

// How far from the limit a near draw puts the used amount, so a property meets both sides of it and the limit itself
const NEAR_LIMIT_SPREAD = 2

// The meters treat a limit of zero or less as having no room to measure, and a zero limit is the one a
// division can't take, so it is drawn often
const limits = fc.oneof(signedMinorUnits, fc.constant(0))

/**
 * Draws a limit and a used amount, half the time within a few minor units of each other, since two
 * independent draws almost never land on the edge where the meter fills
 */
const limitsAndUsage: fc.Arbitrary<[number, number]> = fc.oneof(
  fc.tuple(limits, signedMinorUnits),
  fc
    .tuple(limits, fc.integer({ min: -NEAR_LIMIT_SPREAD, max: NEAR_LIMIT_SPREAD }))
    .map(([limit, offset]): [number, number] => [limit, limit + offset])
    .filter(([, used]) => Number.isSafeInteger(used)),
)

describe('tax-advantaged limit helpers', () => {
  it('keeps the meter and its percent between empty and full for any used amount and limit', () => {
    fc.assert(
      fc.property(limitsAndUsage, ([limit, used]) => {
        for (const percent of [
          getTaxAdvantagedUsagePercent(used, limit),
          getTaxAdvantagedUsageLabelPercent(used, limit),
        ]) {
          expect(percent).toBeGreaterThanOrEqual(0)
          expect(percent).toBeLessThanOrEqual(100)
        }
      }),
    )
  })

  it('says over only when the used amount exceeds the limit', () => {
    fc.assert(
      fc.property(limitsAndUsage, fc.constantFrom('USD', 'CAD'), ([limit, used], currency) => {
        const { remainingLabel } = getTaxAdvantagedMeterLabels(used, limit, currency, testCurrencies)

        expect(remainingLabel.endsWith(' over')).toBe(used > limit)
      }),
    )
  })

  it.each([
    ['more than the limit fills the meter and says over', 750_000, 100, 'CA$500 over'],
    ['exactly the limit fills the meter without saying over', 700_000, 100, 'CA$0'],
    ['a refund leaving less than nothing empties the meter', -20_000, 0, 'CA$7.2K'],
  ])('shows that %s', (_, used, percent, remainingLabel) => {
    const limit = 700_000

    expect(getTaxAdvantagedUsagePercent(used, limit)).toBe(percent)
    expect(getTaxAdvantagedUsageLabelPercent(used, limit)).toBe(percent)
    expect(getTaxAdvantagedMeterLabels(used, limit, 'CAD', testCurrencies).remainingLabel).toBe(remainingLabel)
  })

  it('colours usage over the limit as negative and usage at the limit as spent', () => {
    expect(getTaxAdvantagedUsageColor(125, 100)).toBe('var(--app-negative)')
    expect(getTaxAdvantagedUsageColor(100, 100)).toBe('var(--app-text-muted)')
  })

  it('draws the meter bar in the chart colours while its percentage keeps the text ones', () => {
    expect(getTaxAdvantagedUsageBarColor(125, 100)).toBe('var(--app-chart-negative)')
    expect(getTaxAdvantagedUsageBarColor(50, 100)).toBe('var(--app-accent)')
    expect(getTaxAdvantagedUsageColor(50, 100)).toBe('var(--app-accent)')

    // The two agree on which band the usage is in, so only the shade differs
    expect(getTaxAdvantagedUsageBarColor(100, 100)).toBe('var(--app-text-muted)')
    expect(getTaxAdvantagedUsageBarColor(0, 0)).toBe('var(--app-text-muted)')
    expect(getTaxAdvantagedUsageColor(0, 0)).toBe('var(--app-text-muted)')
    expect(getTaxAdvantagedUsageBarColor(10, 0)).toBe('var(--app-chart-negative)')
    expect(getTaxAdvantagedUsageColor(10, 0)).toBe('var(--app-negative)')
  })

  it('keeps meter amounts whole and unprefixed below the compaction thresholds', () => {
    // The meter shows this beside the limit it is measured against, so a small amount must match
    // how that limit is written: no cents, and no "≈" marking one of the pair as approximate
    expect(formatTaxAdvantagedMeterMoney(50_000, 'CAD', testCurrencies, 'down')).toBe('CA$500')
    expect(formatTaxAdvantagedMeterMoney(0, 'CAD', testCurrencies, 'up')).toBe('CA$0')
  })

  it('shows an amount too small for the meter as zero rather than as a negative', () => {
    // The meter renders no decimals, and accounting style decides to wrap a negative before it
    // rounds, so being 40 cents over a limit would otherwise read as (CA$0)
    expect(formatTaxAdvantagedMeterMoney(-40, 'CAD', testCurrencies, 'up')).toBe('CA$0')
    // Far enough from zero to keep its sign
    expect(formatTaxAdvantagedMeterMoney(-60, 'CAD', testCurrencies, 'down')).toBe('(CA$1)')
  })

  it('rounds a negative meter amount down to a larger size', () => {
    expect(formatTaxAdvantagedMeterMoney(-12_300_000, 'USD', testCurrencies, 'down')).toBe('($123.0K)')
  })

  it('rounds a compacted meter amount at the tenth in the direction of its figure', () => {
    // 1,150 major units is 1.15 thousand: contributions made read as 1.2K, room left as 1.1K
    expect(formatTaxAdvantagedMeterMoney(115_000, 'CAD', testCurrencies, 'up')).toBe('CA$1.2K')
    expect(formatTaxAdvantagedMeterMoney(115_000, 'CAD', testCurrencies, 'down')).toBe('CA$1.1K')
  })

  it('reads a meter amount that rounds up to a million as a million', () => {
    // 999,999.99 is 1,000.0K once rounded up, which would be a third way of writing a million
    expect(formatTaxAdvantagedMeterMoney(99_999_999, 'CAD', testCurrencies, 'up')).toBe('CA$1.0M')
    expect(formatTaxAdvantagedMeterMoney(99_999_999, 'CAD', testCurrencies, 'down')).toBe('CA$999.9K')
  })

  it('writes room used and over up, and the limit and room left down', () => {
    // 1,150 of a 3,999.99 limit: 2,849.99 of room is left
    expect(getTaxAdvantagedMeterLabels(115_000, 399_999, 'CAD', testCurrencies)).toEqual({
      usageLabel: 'CA$1.2K / CA$3.9K',
      remainingLabel: 'CA$2.8K',
    })
    // 1,150 against a 1,000.01 limit is 149.99 over
    expect(getTaxAdvantagedMeterLabels(115_000, 100_001, 'CAD', testCurrencies).remainingLabel).toBe('CA$150 over')
  })

  it('labels usage with the percent rounded up and held to the bar', () => {
    expect(getTaxAdvantagedUsageLabelPercent(1, 3)).toBe(34)
    expect(getTaxAdvantagedUsageLabelPercent(5, 0)).toBe(100)
  })

  it('fills the meter when the limit leaves no room to measure', () => {
    expect(getTaxAdvantagedUsagePercent(5, 0)).toBe(100)
    expect(getTaxAdvantagedUsagePercent(0, -100)).toBe(100)
  })

  it('shows lifetime available boundary only when accrued room is between used and the lifetime cap', () => {
    expect(
      getLifetimeAvailableBoundary(
        createTaxAdvantagedCategory({
          lifetime_contribution_limit: 10_000,
          accrued_lifetime_contribution_limit: 7_000,
          lifetime_contributions: 5_000,
        }),
      ),
    ).toBe(7_000)

    expect(
      getLifetimeAvailableBoundary(
        createTaxAdvantagedCategory({
          lifetime_contribution_limit: 10_000,
          accrued_lifetime_contribution_limit: 4_000,
          lifetime_contributions: 5_000,
        }),
      ),
    ).toBeNull()
  })

  it('detects categories with limit settings or recorded activity', () => {
    expect(hasTaxAdvantagedLimitTracking(createTaxAdvantagedCategory({}))).toBe(false)
    expect(
      hasTaxAdvantagedLimitTracking(
        createTaxAdvantagedCategory({
          current_year_withdrawal_limit: 0,
        }),
      ),
    ).toBe(true)
    expect(
      hasTaxAdvantagedLimitTracking(
        createTaxAdvantagedCategory({
          ytd_contributions: 100,
        }),
      ),
    ).toBe(true)
  })

  it('keeps limit summaries independent from account filters', () => {
    const bank = createInstitution('bank', 'Bank')
    const rows = [
      createAccount({
        id: 'fhsa',
        account_type: 'investment',
        institution: bank,
        tax_advantaged_category_id: 'fhsa',
      }),
      createAccount({
        id: 'rrsp',
        account_type: 'savings',
        institution: null,
        tax_advantaged_category_id: 'rrsp',
      }),
    ]
    const filteredRows = getFilteredRows(rows, { institution_id: ['bank'] }, '')
    const summaries = getTaxAdvantagedLimitSummaries(rows, [
      createTaxAdvantagedCategory({
        id: 'fhsa',
        current_year_contribution_limit: 800_000,
      }),
      createTaxAdvantagedCategory({
        id: 'rrsp',
        current_year_contribution_limit: 3_000_000,
      }),
    ])

    expect(filteredRows.map((account) => account.id)).toEqual(['fhsa'])
    expect(summaries.map((summary) => summary.plan.id)).toEqual(['fhsa', 'rrsp'])
  })
})
