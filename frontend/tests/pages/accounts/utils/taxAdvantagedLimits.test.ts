/**
 * Tests the tax-advantaged limit helpers, so the usage percentages, meter labels and plan summaries
 * cannot drift from the contribution room recorded against each plan
 */
import { describe, expect, it } from 'vitest'
import { getFilteredRows } from '@/pages/accounts/utils/filters'
import {
  formatTaxAdvantagedMeterMoney,
  getLifetimeAvailableBoundary,
  getTaxAdvantagedLimitSummaries,
  getTaxAdvantagedUsageColor,
  getTaxAdvantagedUsagePercent,
  hasTaxAdvantagedLimitTracking,
} from '@/pages/accounts/utils/taxAdvantagedLimits'
import { createAccount, createInstitution, createTaxAdvantagedCategory } from './fixtures'

describe('tax-advantaged limit helpers', () => {
  it('bounds usage percentages and marks over-limit usage as negative', () => {
    expect(getTaxAdvantagedUsagePercent(125, 100)).toBe(100)
    expect(getTaxAdvantagedUsagePercent(-25, 100)).toBe(0)
    expect(getTaxAdvantagedUsageColor(125, 100)).toBe('var(--app-negative)')
    expect(getTaxAdvantagedUsageColor(100, 100)).toBe('var(--app-text-muted)')
  })

  it('formats compact meter values without losing the currency sign', () => {
    expect(formatTaxAdvantagedMeterMoney(123_456, 'USD')).toBe('$1K')
    expect(formatTaxAdvantagedMeterMoney(12_300_000, 'USD')).toBe('$123K')
  })

  it('shows lifetime available boundary only when accrued room is between used and the lifetime cap', () => {
    expect(getLifetimeAvailableBoundary(createTaxAdvantagedCategory({
      lifetime_contribution_limit: 10_000,
      accrued_lifetime_contribution_limit: 7_000,
      lifetime_contributions: 5_000,
    }))).toBe(7_000)

    expect(getLifetimeAvailableBoundary(createTaxAdvantagedCategory({
      lifetime_contribution_limit: 10_000,
      accrued_lifetime_contribution_limit: 4_000,
      lifetime_contributions: 5_000,
    }))).toBeNull()
  })

  it('detects categories with limit settings or recorded activity', () => {
    expect(hasTaxAdvantagedLimitTracking(createTaxAdvantagedCategory({}))).toBe(false)
    expect(hasTaxAdvantagedLimitTracking(createTaxAdvantagedCategory({
      current_year_withdrawal_limit: 0,
    }))).toBe(true)
    expect(hasTaxAdvantagedLimitTracking(createTaxAdvantagedCategory({
      ytd_contributions: 100,
    }))).toBe(true)
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
