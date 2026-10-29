/**
 * Covers how the answers to the opening adjustment offer behave through the query cache the app runs on
 *
 * These tests catch an answer sent to the wrong path or without the amount typed, the offer staying
 * on screen until the account's bank link is read again, the status left as Opening balance to
 * confirm in the link list, a recorded adjustment missing from the transaction lists or the account's
 * figures, a skip reloading the ledger it left alone, another account's figures refreshed, and a
 * refused answer leaving an offer answered elsewhere on screen
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
import { recordOpeningAdjustmentMutationOptions, skipOpeningAdjustmentMutationOptions } from '@/api/bank-sync/hooks'
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
    opening_adjustment: { amount: 25000, waiting_amount: 0, adjustment_date: '2026-05-31' },
    ...overrides,
  }
}

function expectInvalidated(keys: QueryKey[], invalidated: boolean): void {
  for (const key of keys) {
    expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(invalidated)
  }
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

describe('recording the opening adjustment', () => {
  it('sends the amount typed and puts the answer in place of the offer, refreshing the status and the ledger', async () => {
    const answer = createStatus({ opening_adjustment: null })
    authenticatedFetchMock.mockResolvedValue(answer)
    const observer = new MutationObserver(queryClient, recordOpeningAdjustmentMutationOptions(queryClient))

    const recorded = observer.mutate({ accountId: 'account-1', amount: 24000 })
    await vi.runAllTimersAsync()
    await recorded

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/accounts/account-1/bank-link/opening-adjustment/record', {
      method: 'POST',
      body: '{"amount":24000}',
    })
    expect(queryClient.getQueryData(statusKey)).toEqual(answer)
    expectInvalidated([linksKey, ...ledgerKeys], true)
    expectInvalidated([otherAccountKey], false)
  })
})

describe('skipping the opening adjustment', () => {
  it('puts the answer in place of the offer and refreshes the status, leaving the ledger alone', async () => {
    const answer = createStatus({ opening_adjustment: null })
    authenticatedFetchMock.mockResolvedValue(answer)
    const observer = new MutationObserver(queryClient, skipOpeningAdjustmentMutationOptions(queryClient))

    const skipped = observer.mutate('account-1')
    await vi.runAllTimersAsync()
    await skipped

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/accounts/account-1/bank-link/opening-adjustment/skip', {
      method: 'POST',
      body: undefined,
    })
    expect(queryClient.getQueryData(statusKey)).toEqual(answer)
    expectInvalidated([linksKey], true)
    expectInvalidated([...ledgerKeys, otherAccountKey], false)
  })
})

describe('a refused answer', () => {
  it.each([
    [
      'a record',
      () =>
        new MutationObserver(queryClient, recordOpeningAdjustmentMutationOptions(queryClient)).mutate({
          accountId: 'account-1',
          amount: 25000,
        }),
    ],
    [
      'a skip',
      () => new MutationObserver(queryClient, skipOpeningAdjustmentMutationOptions(queryClient)).mutate('account-1'),
    ],
  ])("reads the account's bank link and the link list again after %s, leaving the ledger alone", async (_, answer) => {
    authenticatedFetchMock.mockRejectedValue(new ApiError('There is no opening balance to confirm', 409))

    const sent = answer().catch((error: unknown) => error)
    await vi.runAllTimersAsync()

    expect(await sent).toBeInstanceOf(ApiError)
    expectInvalidated([statusKey, linksKey], true)
    expectInvalidated([...ledgerKeys, otherAccountKey], false)
  })
})
