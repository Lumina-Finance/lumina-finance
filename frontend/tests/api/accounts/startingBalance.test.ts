/**
 * Tests how a starting balance save that ended with no answer is settled by reading the account, so
 * the prompt can close as saved, ask for the balance again, or say the outcome is still unknown
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/auth/errors'
import type { Account } from '@/api/accounts'

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}))

import {
  recordStartingBalanceSettled,
  StartingBalanceNotSavedError,
  StartingBalanceUnsettledError,
} from '@/api/accounts/startingBalance'

const ALREADY_HAS_TRANSACTIONS = "This account already has transactions, so a starting balance can't be recorded"

/**
 * Creates a CAD chequing account as the API returns it, in minor units
 */
function createChequing(currentBalance: number): Account {
  return {
    id: 'chequing',
    owner_id: 'user',
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: 'Everyday',
    institution: null,
    currency: 'CAD',
    current_balance: currentBalance,
    base_currency_current_balance: null,
    current_balance_fx_status: { state: 'none', missing_pairs: [] },
    credit_limit: null,
    can_write: true,
    is_archived: false,
    created_at: '2026-10-04T12:00:00Z',
    has_transactions_after_today: false,
    notes: null,
  }
}

/**
 * Answers the save with the given failure and the account read after it with the given result
 */
function failSaveThenRead(saveFailure: Error, read: Account | Error) {
  authenticatedFetchMock.mockRejectedValueOnce(saveFailure)
  if (read instanceof Error) authenticatedFetchMock.mockRejectedValueOnce(read)
  else authenticatedFetchMock.mockResolvedValueOnce(read)
}

const SAVE = { accountId: 'chequing', payload: { amount: 125000 } }

beforeEach(() => {
  authenticatedFetchMock.mockReset()
})

describe('recordStartingBalanceSettled', () => {
  it('asks for the balance again when the connection dropped and the account is still at zero', async () => {
    failSaveThenRead(new TypeError('Failed to fetch'), createChequing(0))

    await expect(recordStartingBalanceSettled(SAVE)).rejects.toBeInstanceOf(StartingBalanceNotSavedError)
    expect(authenticatedFetchMock).toHaveBeenLastCalledWith('/accounts/chequing', expect.anything())
  })

  it.each([502, 503, 504])('answers as saved when a gateway answered %i after the balance landed', async (status) => {
    const saved = createChequing(125000)
    failSaveThenRead(new ApiError('Gateway error', status), saved)

    await expect(recordStartingBalanceSettled(SAVE)).resolves.toEqual(saved)
  })

  it('answers as saved when a card owing 400.00 reads as a balance of -400.00', async () => {
    const saved = {
      ...createChequing(-40000),
      id: 'card',
      account_kind: 'revolving',
      account_type: 'credit_card',
    } as const
    failSaveThenRead(new TypeError('Failed to fetch'), saved)

    await expect(recordStartingBalanceSettled({ accountId: 'card', payload: { amount: 40000 } })).resolves.toEqual(
      saved,
    )
  })

  it('says the outcome is unknown when the account cannot be read either', async () => {
    failSaveThenRead(new TypeError('Failed to fetch'), new TypeError('Failed to fetch'))

    await expect(recordStartingBalanceSettled(SAVE)).rejects.toBeInstanceOf(StartingBalanceUnsettledError)
  })

  it('answers a second save as saved when the first one landed unseen, whatever the refusal says', async () => {
    const saved = createChequing(125000)
    failSaveThenRead(new ApiError('Refused in other words', 422, { detail: 'Refused in other words' }), saved)

    await expect(recordStartingBalanceSettled(SAVE)).resolves.toEqual(saved)
  })

  it('passes on a refusal when the account does not hold the typed balance', async () => {
    const refusal = new ApiError(ALREADY_HAS_TRANSACTIONS, 422, { detail: ALREADY_HAS_TRANSACTIONS })
    failSaveThenRead(refusal, createChequing(-4250))

    await expect(recordStartingBalanceSettled(SAVE)).rejects.toBe(refusal)
  })

  it('passes on a refusal the server answered without reading the account', async () => {
    const refusal = new ApiError('Account not found', 404, { detail: 'Account not found' })
    authenticatedFetchMock.mockRejectedValueOnce(refusal)

    await expect(recordStartingBalanceSettled(SAVE)).rejects.toBe(refusal)
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(1)
  })
})
