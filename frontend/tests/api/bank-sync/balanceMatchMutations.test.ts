/**
 * Covers how recording the balance match behaves through the query cache the app runs on
 *
 * These tests catch a recording sent to the wrong path, without the offered amount the server checks
 * and records, or with an amount of its own, the offer or the remainder it leaves waiting on
 * screen until the account's bank link is read again, a recorded adjustment missing from the
 * transaction lists or the account's figures, another account's figures refreshed, and a refused
 * recording leaving an offer that moved meanwhile on screen
 */
import { MutationObserver, QueryClient, type QueryKey } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}))

import { ApiError } from '@/api/auth'
import { recordBalanceMatchMutationOptions } from '@/api/bank-sync/hooks'
import type { AccountBankStatus } from '@/api/bank-sync/types'
import { accountKeys, bankSyncKeys, transactionKeys } from '@/api/cache/queryKeys'

let queryClient: QueryClient

const statusKey = bankSyncKeys.accountStatus('account-1')
const linksKey = bankSyncKeys.links()
const ledgerKeys: QueryKey[] = [transactionKeys.list({}), accountKeys.detail('account-1')]
const otherAccountKey = accountKeys.detail('account-2')

/** Everyday's bank link, offering 250.00 dated May 31 unless told otherwise */
function createStatus(overrides: Partial<AccountBankStatus> = {}): AccountBankStatus {
  return {
    account_id: 'account-1',
    link: null,
    previous_link: null,
    balance: null,
    balance_match: { amount: 25000, waiting_amount: 0, adjustment_date: '2026-05-31' },
    ...overrides,
  }
}

function expectInvalidated(keys: QueryKey[], invalidated: boolean): void {
  for (const key of keys) {
    expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(invalidated)
  }
}

/** Record the offered 250.00 through the mutation the app runs */
function record() {
  return new MutationObserver(queryClient, recordBalanceMatchMutationOptions(queryClient)).mutate({
    accountId: 'account-1',
    offeredAmount: 25000,
  })
}

beforeEach(() => {
  authenticatedFetchMock.mockReset()
  vi.useFakeTimers()
  queryClient = new QueryClient()
  for (const key of [statusKey, linksKey, ...ledgerKeys, otherAccountKey]) queryClient.setQueryData(key, {})
  queryClient.setQueryData(statusKey, createStatus())
})

afterEach(() => {
  queryClient.clear()
  vi.useRealTimers()
})

describe('recording the balance match', () => {
  it('sends the offered amount alone and puts the offer the server answers with in its place, refreshing the status and the ledger', async () => {
    const answer = createStatus({ balance_match: { amount: 1000, waiting_amount: 0, adjustment_date: '2026-05-31' } })
    authenticatedFetchMock.mockResolvedValue(answer)

    const recorded = record()
    await vi.runAllTimersAsync()
    await recorded

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/accounts/account-1/bank-link/balance-match', {
      method: 'POST',
      body: '{"offered_amount":25000}',
    })
    expect(queryClient.getQueryData(statusKey)).toEqual(answer)
    expectInvalidated([linksKey, ...ledgerKeys], true)
    expectInvalidated([otherAccountKey], false)
  })

  it("reads the account's bank link and the link list again after a refusal, leaving the ledger alone", async () => {
    authenticatedFetchMock.mockRejectedValue(
      new ApiError('The difference has changed. Please check the new amount and try again', 409),
    )

    const sent = record().catch((error: unknown) => error)
    await vi.runAllTimersAsync()

    expect(await sent).toBeInstanceOf(ApiError)
    expectInvalidated([statusKey, linksKey], true)
    expectInvalidated([...ledgerKeys, otherAccountKey], false)
  })
})
