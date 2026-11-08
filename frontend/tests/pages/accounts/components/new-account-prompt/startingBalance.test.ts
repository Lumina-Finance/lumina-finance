/**
 * Guards Continue refusing, rather than going ahead, while the starting balance shows "Must be zero or
 * higher". A press then closed the prompt with nothing recorded, though the field was marked as wrong
 */
import { describe, expect, it } from 'vitest'
import { getFirstProblem, getShownProblems } from '@/utils/refusedSubmit'
import {
  getStartingBalanceProblems,
  MUST_BE_ZERO_OR_HIGHER_MESSAGE,
  STARTING_BALANCE_FIELDS,
} from '@/pages/accounts/components/new-account-prompt/startingBalance'

describe('what holds Continue in the new account prompt', () => {
  it('holds it with the message while a refused minus shows and the account is kept manual', () => {
    const problems = getStartingBalanceProblems(true, true)

    expect(getFirstProblem(problems, STARTING_BALANCE_FIELDS)).toEqual({
      field: 'starting_balance',
      message: MUST_BE_ZERO_OR_HIGHER_MESSAGE,
    })
    expect(getShownProblems(problems, true, new Set())).toEqual(problems)
  })

  it('lets Continue go ahead once the minus is taken back', () => {
    expect(getFirstProblem(getStartingBalanceProblems(true, false), STARTING_BALANCE_FIELDS)).toBeNull()
  })

  it('lets Continue link the bank account although the hidden field once refused a minus', () => {
    expect(getFirstProblem(getStartingBalanceProblems(false, true), STARTING_BALANCE_FIELDS)).toBeNull()
  })
})
