/**
 * Tests the tax-advantaged category form checks, so each missing or wrong input lands on its own field
 * and the dialogue can mark it there, instead of one message for the whole form
 */
import { describe, expect, it } from 'vitest'
import type { TaxPlanFormState } from '@/pages/settings/components/tax-advantaged/types'
import {
  getCategoryDetailsProblems,
  getCreateCategoryProblems,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/utils/categoryFormProblems'

const validForm: TaxPlanFormState = {
  name: 'TFSA',
  tax_treatment: 'tax_free',
  currency: 'CAD',
  lifetime_contribution_limit: '',
  accrued_contributions: '',
  counts_internal_transfers: false,
}

describe('getCreateCategoryProblems', () => {
  it('reports nothing for a complete form', () => {
    expect(getCreateCategoryProblems(validForm, 'CAD')).toEqual({})
  })

  it('reports every field that is wrong on its own', () => {
    const problems = getCreateCategoryProblems(
      { ...validForm, name: '   ', lifetime_contribution_limit: '-5', accrued_contributions: 'abc' },
      '',
    )

    expect(Object.keys(problems)).toEqual(['name', 'currency', 'lifetimeContributionLimit', 'accruedContributions'])
  })
})

describe('getCategoryDetailsProblems', () => {
  it('reports the emptied name, the limit and the opening usage separately', () => {
    expect(getCategoryDetailsProblems({ ...validForm, name: '' })).toEqual({ name: 'Name is required' })
    expect(getCategoryDetailsProblems({ ...validForm, lifetime_contribution_limit: '-1' })).toEqual({
      lifetimeLimit: 'Lifetime limit must be zero or higher',
    })
    expect(getCategoryDetailsProblems({ ...validForm, accrued_contributions: '-1' })).toEqual({
      openingUsage: 'Opening usage must be zero or higher',
    })
  })
})
