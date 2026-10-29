/**
 * Covers the cache writes after a profile change, so a new timezone doesn't leave a view built on
 * the old one's days on screen
 *
 * This test catches an account's bank link keeping a ledger balance taken at the end of the bank's
 * balance date in the old timezone
 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { bankSyncKeys } from '@/api/cache/queryKeys'
import { invalidateProfileUpdateCaches } from '@/api/cache/updates/user'

describe('invalidateProfileUpdateCaches', () => {
  it('reads each bank link again when the timezone changes, since its ledger ends on a day in it', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(bankSyncKeys.accountStatus('everyday'), {})

    invalidateProfileUpdateCaches(queryClient, { tz: 'America/Phoenix' })

    expect(queryClient.getQueryState(bankSyncKeys.accountStatus('everyday'))?.isInvalidated).toBe(true)
  })
})
