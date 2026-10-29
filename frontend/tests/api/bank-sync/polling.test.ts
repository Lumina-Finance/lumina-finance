/**
 * Covers how often the signed-in app reads the bank link list, whether it reads it on coming back to
 * the tab, how long a read stays fresh, and how long the connections are read after a claim
 *
 * These tests catch a user with no links being polled, a running sync or import, or a Sync now about
 * to start, being read at the slow pace so its progress lags, an import waiting on the request budget being read at the fast
 * pace for the hours it can wait, a refused read being asked again, including each time the user
 * comes back to the tab, a server failure taken for a refusal and never asked again, a user with
 * no links keeping an old read so a link made on another device never shows, and the connections read
 * for good after a claim the app didn't answer
 */
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/auth/errors'
import {
  BANK_LINKS_ACTIVE_POLL_MS,
  BANK_LINKS_IDLE_POLL_MS,
  UNANSWERED_CLAIM_POLL_MS,
  UNANSWERED_CLAIM_WATCH_MS,
} from '@/api/bank-sync/constants'
import {
  getBankConnectionsPollInterval,
  getBankLinksPollInterval,
  getBankLinksRefetchOnReturn,
  getBankLinksStaleTime,
} from '@/api/bank-sync/polling'
import { createBankLink, createImportingBankLink, createSyncStatus } from './fixtures'

const syncingLink = () => createBankLink({ sync: createSyncStatus({ state: 'syncing' }) })

describe('bank link polling interval', () => {
  it.each([
    ['before the first read', undefined],
    ['for a user with no links', []],
  ])('does not poll %s', (_, links) => {
    expect(getBankLinksPollInterval(links, null)).toBe(false)
  })

  it('polls slowly while every link is idle', () => {
    expect(getBankLinksPollInterval([createBankLink(), createImportingBankLink('complete')], null)).toBe(
      BANK_LINKS_IDLE_POLL_MS,
    )
  })

  it('polls quickly while any one link syncs', () => {
    expect(getBankLinksPollInterval([createBankLink(), syncingLink()], null)).toBe(BANK_LINKS_ACTIVE_POLL_MS)
  })

  it('polls quickly while a Sync now waits for a worker to start it, so the sync shows as soon as it starts', () => {
    expect(getBankLinksPollInterval([createBankLink({ sync: createSyncStatus({ sync_requested: true }) })], null)).toBe(
      BANK_LINKS_ACTIVE_POLL_MS,
    )
  })

  it('polls quickly while a sync runs under a bank sign-in, which shows over it', () => {
    const link = createBankLink({ sync: createSyncStatus({ state: 'bank_signin_needed', sync_running: true }) })
    expect(getBankLinksPollInterval([link], null)).toBe(BANK_LINKS_ACTIVE_POLL_MS)
  })

  it('polls quickly while an import runs', () => {
    expect(getBankLinksPollInterval([createBankLink(), createImportingBankLink('running')], null)).toBe(
      BANK_LINKS_ACTIVE_POLL_MS,
    )
  })

  it('polls slowly while an import waits on the request budget', () => {
    expect(getBankLinksPollInterval([createImportingBankLink('waiting_on_budget')], null)).toBe(BANK_LINKS_IDLE_POLL_MS)
  })

  it('tries a first read that failed on the way again at the slow pace, and leaves a refused one alone', () => {
    expect(getBankLinksPollInterval(undefined, new TypeError('Network unavailable'))).toBe(BANK_LINKS_IDLE_POLL_MS)
    expect(getBankLinksPollInterval(undefined, new ApiError('Not Found', 404))).toBe(false)
  })

  it('tries a first read the server failed on again at the slow pace, since that is not a refusal', () => {
    expect(getBankLinksPollInterval(undefined, new ApiError('Server error', 500))).toBe(BANK_LINKS_IDLE_POLL_MS)
  })
})

describe('reading the bank link list on coming back to the tab', () => {
  it('leaves a first read the server refused alone when the user comes back', () => {
    expect(getBankLinksRefetchOnReturn(undefined, new ApiError('Not Found', 404))).toBe(false)
  })
})

describe('bank link freshness', () => {
  it('keeps a read with no links fresh for as long as an idle poll would', () => {
    expect(getBankLinksStaleTime([])).toBe(BANK_LINKS_IDLE_POLL_MS)
  })
})

describe('connections polling after a claim the app did not answer', () => {
  const claimUnansweredAt = Date.UTC(2026, 9, 10, 12)

  it('reads the connections again while the server may still be saving the claimed one', () => {
    expect(
      getBankConnectionsPollInterval([], claimUnansweredAt, claimUnansweredAt + UNANSWERED_CLAIM_WATCH_MS - 1),
    ).toBe(UNANSWERED_CLAIM_POLL_MS)
  })

  it('stops once the claim has had as long as it could take', () => {
    expect(getBankConnectionsPollInterval([], claimUnansweredAt, claimUnansweredAt + UNANSWERED_CLAIM_WATCH_MS)).toBe(
      false,
    )
  })
})
