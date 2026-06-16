/**
 * Tests TAC modal helper behaviour so field-only keyboard focus stays aligned across create, details, and annual-limit dialogs
 */
import { describe, expect, it } from 'vitest'
import { getNextModalFieldTabStop } from '@/components/modal/focus'
import { CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/modalFieldIds'

describe('tax-advantaged category modal field focus', () => {
  it('wraps create TAC modal Tab focus through field controls only', () => {
    const fieldTabStops = [
      CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.name,
      CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.taxTreatment,
      CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.currency,
      CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.lifetimeContributionLimit,
      CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.accruedContributions,
    ]

    expect(getNextModalFieldTabStop(fieldTabStops, null, false)).toBe(CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.name)
    expect(getNextModalFieldTabStop(fieldTabStops, CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.name, false)).toBe(CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.taxTreatment)
    expect(getNextModalFieldTabStop(fieldTabStops, CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.taxTreatment, false)).toBe(CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.currency)
    expect(getNextModalFieldTabStop(fieldTabStops, CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.accruedContributions, false)).toBe(CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.name)
    expect(getNextModalFieldTabStop(fieldTabStops, CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.name, true)).toBe(CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.accruedContributions)
  })
})
