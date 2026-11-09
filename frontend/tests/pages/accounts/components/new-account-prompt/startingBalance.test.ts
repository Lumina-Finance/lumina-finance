/**
 * Guards Continue refusing, rather than going ahead, while the starting balance shows "Must be zero or
 * higher". A press then closed the prompt with nothing recorded, though the field was marked as wrong.
 * It also guards the amount a liability records, which is the amount owed as a positive number
 */
import { describe, expect, it } from 'vitest'
import { getFirstProblem, getShownProblems } from '@/utils/refusedSubmit'
import {
  buildStartingBalanceRequest,
  getStartingBalanceProblems,
  MUST_BE_ZERO_OR_HIGHER_MESSAGE,
  STARTING_BALANCE_FIELDS,
} from '@/pages/accounts/components/new-account-prompt/startingBalance'
import { createAccount } from './fixtures'

describe('what holds Continue in the new account prompt', () => {
  it('holds it with the message while a refused minus shows and the account is kept manual', () => {
    const problems = getStartingBalanceProblems(true, true, '')

    expect(getFirstProblem(problems, STARTING_BALANCE_FIELDS)).toEqual({
      field: 'starting_balance',
      message: MUST_BE_ZERO_OR_HIGHER_MESSAGE,
    })
    expect(getShownProblems(problems, true, new Set())).toEqual(problems)
  })

  it('holds it with the message for a point alone, as the Add account dialogue did', () => {
    expect(getFirstProblem(getStartingBalanceProblems(true, false, '.'), STARTING_BALANCE_FIELDS)).toEqual({
      field: 'starting_balance',
      message: MUST_BE_ZERO_OR_HIGHER_MESSAGE,
    })
  })

  it('lets Continue go ahead once the minus is taken back, and for a blank or whole amount', () => {
    for (const text of ['', '1250.00']) {
      expect(getFirstProblem(getStartingBalanceProblems(true, false, text), STARTING_BALANCE_FIELDS)).toBeNull()
    }
  })

  it('lets Continue link the bank account although the hidden field holds something refused', () => {
    expect(getFirstProblem(getStartingBalanceProblems(false, true, '.'), STARTING_BALANCE_FIELDS)).toBeNull()
  })
})

describe('the request that records a starting balance', () => {
  it('sends the amount owed on a liability as a positive amount, which the backend saves negated', () => {
    const card = createAccount({ id: 'card-1', account_kind: 'revolving', account_type: 'credit_card' })

    expect(buildStartingBalanceRequest(card, '400.00', 2)).toEqual({ accountId: 'card-1', payload: { amount: 40000 } })
  })

  it('sends an asset’s balance the same way, at the currency’s own exponent', () => {
    expect(buildStartingBalanceRequest(createAccount({ id: 'cheque-1' }), '1250', 2)?.payload.amount).toBe(125000)
    expect(
      buildStartingBalanceRequest(createAccount({ id: 'yen-1', currency: 'JPY' }), '1250', 0)?.payload.amount,
    ).toBe(1250)
  })

  it('records nothing for a blank or zero balance, which the account already has', () => {
    const account = createAccount()

    expect(buildStartingBalanceRequest(account, '', 2)).toBeNull()
    expect(buildStartingBalanceRequest(account, '0.00', 2)).toBeNull()
  })
})
