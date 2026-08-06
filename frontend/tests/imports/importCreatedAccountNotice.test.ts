/**
 * Tests when the new-account notice shows, so the step never claims an account is being created
 * when none is, and never goes quiet on a row that is
 */
import { describe, expect, it } from 'vitest'
import { CREATE_ACCOUNT_VALUE } from '@/pages/imports/constants'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import { isCreatingImportAccount } from '@/pages/imports/utils'

describe('when the new-account notice shows', () => {
  it('stays hidden while every source points at an account that already exists', () => {
    expect(isCreatingImportAccount([{ value: 'account-1' }, { value: 'account-2' }])).toBe(false)
  })

  it('stays hidden for the outside answer, an unanswered row and an empty step', () => {
    expect(isCreatingImportAccount([{ value: OUTSIDE_ACCOUNT_VALUE }])).toBe(false)
    expect(isCreatingImportAccount([{ value: '' }])).toBe(false)
    expect(isCreatingImportAccount([])).toBe(false)
  })

  // The notice is about having chosen to create, which happens before the type and currency
  // dropdowns are touched, so it cannot wait for a row to be finished
  it('shows for a create row with nothing else filled in yet', () => {
    expect(isCreatingImportAccount([{ value: CREATE_ACCOUNT_VALUE }])).toBe(true)
  })

  it('shows where one row among several is set to create', () => {
    expect(
      isCreatingImportAccount([
        { value: 'account-1' },
        { value: OUTSIDE_ACCOUNT_VALUE },
        { value: CREATE_ACCOUNT_VALUE },
      ]),
    ).toBe(true)
  })
})
