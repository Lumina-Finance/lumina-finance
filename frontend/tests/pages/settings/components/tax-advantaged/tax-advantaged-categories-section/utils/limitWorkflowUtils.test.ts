/**
 * Tests the annual limit form checks, so a year that is out of range or already taken, and each amount
 * that is missing or negative, is reported on its own field
 */
import { describe, expect, it } from 'vitest'
import type { TaxAdvantagedCategoryLimit } from '@/api/tax-advantaged-categories'
import type { TaxPlanLimitFormState } from '@/pages/settings/components/tax-advantaged/types'
import {
  getLimitAmountProblems,
  getNewLimitProblems,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/utils/limitWorkflowUtils'

const validForm: TaxPlanLimitFormState = {
  year: '2025',
  contribution_limit: '7000',
  withdrawal_limit: '',
  accrued_contributions: '',
  accrued_withdrawals: '',
}

const existingLimit = { year: 2024 } as TaxAdvantagedCategoryLimit

describe('getLimitAmountProblems', () => {
  it('requires the contribution limit and refuses a negative amount anywhere', () => {
    expect(getLimitAmountProblems(validForm)).toEqual({})
    expect(getLimitAmountProblems({ ...validForm, contribution_limit: '' })).toEqual({
      contribution_limit: 'Limit is required',
    })
    expect(
      getLimitAmountProblems({ ...validForm, withdrawal_limit: '-1', accrued_contributions: '-1', accrued_withdrawals: '-1' }),
    ).toEqual({
      withdrawal_limit: 'Withdrawal limit must be zero or higher',
      accrued_contributions: 'Opening contributions must be zero or higher',
      accrued_withdrawals: 'Opening withdrawals must be zero or higher',
    })
  })
})

describe('getNewLimitProblems', () => {
  it('refuses a year outside the supported range or one that already has a limit', () => {
    expect(getNewLimitProblems(validForm, [existingLimit])).toEqual({})
    expect(getNewLimitProblems({ ...validForm, year: '1899' }, [])).toEqual({
      year: 'Year must be between 1900 and 2100',
    })
    expect(getNewLimitProblems({ ...validForm, year: '' }, [])).toEqual({
      year: 'Year must be between 1900 and 2100',
    })
    expect(getNewLimitProblems({ ...validForm, year: '2024' }, [existingLimit])).toEqual({
      year: 'A limit for 2024 already exists',
    })
  })

  it('reports the year together with the amounts that are wrong', () => {
    const problems = getNewLimitProblems({ ...validForm, year: '2101', contribution_limit: '' }, [])

    expect(Object.keys(problems).sort()).toEqual(['contribution_limit', 'year'])
  })
})
