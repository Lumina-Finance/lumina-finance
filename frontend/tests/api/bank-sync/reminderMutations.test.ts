/**
 * Covers how dismissing a reminder in the Bank link section behaves through the query cache the app runs on
 *
 * These tests catch a dismissal sent to the wrong path or without the reminder as it showed, and
 * the server needs it to leave a newer one in place, the reminder staying on screen until the account's
 * bank link is read again, the link list left holding it, the ledger reloaded though nothing in it
 * changed, and a refused dismissal leaving a reminder on screen that the server no longer shows
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
import { dismissBankReminderMutationOptions } from '@/api/bank-sync/hooks'
import { dismissCutOffDay, dismissHistoryReminder } from '@/api/bank-sync/requests'
import type { AccountBankStatus } from '@/api/bank-sync/types'
import { accountKeys, bankSyncKeys, transactionKeys } from '@/api/cache/queryKeys'
import { createBankLink } from './fixtures'

let queryClient: QueryClient

const statusKey = bankSyncKeys.accountStatus('account-1')
const linksKey = bankSyncKeys.links()
const untouchedKeys: QueryKey[] = [
  transactionKeys.list({}),
  accountKeys.detail('account-1'),
  bankSyncKeys.accountStatus('account-2'),
]

// Everyday's import from Jun 1 got history from Jun 9, and Oct 3 brought back as many as SimpleFIN sends at once
const REMINDER = { requested_start: '2026-06-01', earliest_returned: '2026-06-09' }

/** Everyday's bank link, showing both reminders unless told otherwise */
function createStatus(overrides: Parameters<typeof createBankLink>[0] = {}): AccountBankStatus {
  return {
    account_id: 'account-1',
    link: createBankLink({ history_reminder: REMINDER, cut_off_day: '2026-10-03', ...overrides }),
    previous_link: null,
    balance: null,
    opening_adjustment: null,
  }
}

function expectInvalidated(keys: QueryKey[], invalidated: boolean): void {
  for (const key of keys) {
    expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(invalidated)
  }
}

const dismissals = [
  [
    'the history reminder',
    () =>
      new MutationObserver(queryClient, dismissBankReminderMutationOptions(queryClient, dismissHistoryReminder)).mutate(
        { accountId: 'account-1', reminder: REMINDER },
      ),
    '/accounts/account-1/bank-link/history-reminder/dismiss',
    '{"requested_start":"2026-06-01","earliest_returned":"2026-06-09"}',
    createStatus({ history_reminder: null }),
  ],
  [
    'the cut-off day',
    () =>
      new MutationObserver(queryClient, dismissBankReminderMutationOptions(queryClient, dismissCutOffDay)).mutate({
        accountId: 'account-1',
        day: '2026-10-03',
      }),
    '/accounts/account-1/bank-link/cut-off-day/dismiss',
    '{"day":"2026-10-03"}',
    createStatus({ cut_off_day: null }),
  ],
] as const

beforeEach(() => {
  authenticatedFetchMock.mockReset()
  vi.useFakeTimers()
  queryClient = new QueryClient()
  for (const key of [linksKey, ...untouchedKeys]) queryClient.setQueryData(key, {})
  queryClient.setQueryData(statusKey, createStatus())
})

afterEach(() => {
  queryClient.clear()
  vi.useRealTimers()
})

describe('dismissing a reminder', () => {
  it.each(dismissals)(
    'sends %s as it showed and puts the answer in place, refreshing the link list alone',
    async (_, dismiss, path, body, answer) => {
      authenticatedFetchMock.mockResolvedValue(answer)

      const dismissed = dismiss()
      await vi.runAllTimersAsync()
      await dismissed

      expect(authenticatedFetchMock).toHaveBeenCalledWith(path, { method: 'POST', body })
      expect(queryClient.getQueryData(statusKey)).toEqual(answer)
      expectInvalidated([linksKey], true)
      expectInvalidated([statusKey, ...untouchedKeys], false)
    },
  )

  it.each(dismissals)(
    "reads the account's bank link and the link list again when the server refuses %s",
    async (_, dismiss) => {
      authenticatedFetchMock.mockRejectedValue(new ApiError('This account is not linked to a bank', 404))

      const sent = dismiss().catch((error: unknown) => error)
      await vi.runAllTimersAsync()

      expect(await sent).toBeInstanceOf(ApiError)
      expect(queryClient.getQueryData(statusKey)).toEqual(createStatus())
      expectInvalidated([statusKey, linksKey], true)
      expectInvalidated(untouchedKeys, false)
    },
  )
})
