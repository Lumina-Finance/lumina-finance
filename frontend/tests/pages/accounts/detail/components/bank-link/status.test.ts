/**
 * Covers whether an account's page shows bank sync, the account's bank sync as its page labels it,
 * with the Sync details' lines, and the import heading for each reason an import runs
 *
 * These tests catch bank sync shown to a user the deployment lets link nothing, a linked account's
 * link hidden once the user may no longer link, a failed read shown as still checking, any state
 * worded, coloured or blinking unlike the others or the prototype, a waiting import blinking as if it
 * were fetching, a detail line repeating the label or leaving out the failure or the next sync, a retry
 * or an import's next part timed by the UTC day rather than the user's, a relink's catch-up
 * described as an import from the link's first day, and a next sync blamed on the wrong request limit
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BankLink } from '@/api/bank-sync'
import {
  describeBankSync,
  describeImportHeading,
  isLinkStillUnread,
  showsBankSync,
  type BankSyncLabel,
} from '@/pages/accounts/detail/components/bank-link/status'
import { createImport, createLink, createPreviousLink, createProviders, createStatus, createSync } from './fixtures'

const TIME_ZONE = 'America/Toronto'

// Noon in Toronto, the clock the link fixtures are set against
const NOW = '2026-10-05T16:00:00Z'

const FAILURE = { at: '2026-10-05T14:00:00Z', reason: 'Bank unavailable' }
const FAILURE_LINE = 'Last attempt failed 2 hours ago: Bank unavailable'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * The label and details for a linked account, with the narrow spaces some times are formatted with
 * read as plain ones
 */
function describeLink(link: BankLink): BankSyncLabel {
  const plain = (text: string) => text.replace(/\s/g, ' ')
  const sync = describeBankSync(true, createStatus({ link }), false, TIME_ZONE)
  return { ...sync, label: plain(sync.label), details: sync.details.map(plain) }
}

describe('isLinkStillUnread', () => {
  it.each([
    ['before the providers are read', undefined],
    ['while the user may link through a provider', createProviders()],
  ])('holds the institution line %s, since the link could still name a bank', (_, providers) => {
    expect(isLinkStillUnread(true, providers, undefined, false)).toBe(true)
  })

  it.each([
    ['the user may link nothing', createProviders({ may_link: false })],
    ['the deployment has no provider', createProviders({ providers: [] })],
  ])('lets an account read as it always has once %s', (_, providers) => {
    expect(isLinkStillUnread(true, providers, undefined, false)).toBe(false)
  })

  it('stops holding once the link is read or failed to be, and for an account the link is never read for', () => {
    expect(isLinkStillUnread(true, createProviders(), createStatus(), false)).toBe(false)
    expect(isLinkStillUnread(true, createProviders(), undefined, true)).toBe(false)
    expect(isLinkStillUnread(false, undefined, undefined, false)).toBe(false)
  })
})

describe('showsBankSync', () => {
  it('shows while the user may link through a provider', () => {
    expect(showsBankSync(createProviders(), createStatus())).toBe(true)
  })

  it.each([
    ['before the providers are read', undefined],
    ['to a user the deployment lets link nothing', createProviders({ may_link: false })],
    ['on a deployment with no provider', createProviders({ providers: [] })],
  ])('leaves an unlinked account without it %s', (_, providers) => {
    expect(showsBankSync(providers, createStatus())).toBe(false)
  })

  it('keeps it for a linked account once the user may no longer link', () => {
    expect(showsBankSync(createProviders({ may_link: false }), createStatus({ link: createLink() }))).toBe(true)
  })
})

describe('describeBankSync without a live link', () => {
  it('labels an account that is not the user own personal one as manual only', () => {
    expect(describeBankSync(false, undefined, false)).toEqual({
      label: 'Manual only',
      tone: 'off',
      pulse: false,
      details: [],
    })
  })

  it('says it is checking until the link is read, and that it could not check once the read fails', () => {
    expect(describeBankSync(true, undefined, false)).toEqual({
      label: 'Checking…',
      tone: 'off',
      pulse: false,
      details: [],
    })
    expect(describeBankSync(true, undefined, true)).toEqual({
      label: 'Status unavailable',
      tone: 'off',
      pulse: false,
      details: [],
    })
  })

  it('labels an account without a live link as not linked, whether or not it was linked before', () => {
    expect(describeBankSync(true, createStatus(), false)).toEqual({
      label: 'No bank link',
      tone: 'off',
      pulse: false,
      details: [],
    })
    expect(describeBankSync(true, createStatus({ previous_link: createPreviousLink() }), false).label).toBe(
      'No bank link',
    )
  })
})

describe('describeBankSync for a live link', () => {
  it.each<[string, Partial<BankLink>, BankSyncLabel]>([
    [
      'a synced link, with when it syncs next',
      {},
      { label: 'Synced 1 hour ago', tone: 'ok', pulse: false, details: ['Next sync in 3 hours'] },
    ],
    [
      'a link reconnected before it first synced, waiting on its catch-up',
      { sync: createSync({ last_success_at: null, next_attempt_at: null }) },
      { label: 'Not synced yet', tone: 'ok', pulse: false, details: [] },
    ],
    [
      // Such as a payment problem the user settles with the provider, which only the daily sync tries again
      'a synced link whose last attempt failed, waiting on its daily sync',
      { sync: createSync({ last_failure: FAILURE }) },
      {
        label: 'Last sync failure',
        tone: 'review',
        pulse: false,
        details: [FAILURE.reason, 'Synced 1 hour ago', 'Next sync in 3 hours'],
      },
    ],
    [
      "a synced link whose next sync waits on the connection's own request limit",
      { sync: createSync({ waiting_on_budget: true }) },
      {
        label: 'Synced 1 hour ago',
        tone: 'ok',
        pulse: false,
        details: ["Next sync is waiting on this connection's 24-hour SimpleFIN request limit"],
      },
    ],
    [
      'a rejected connection',
      { sync: createSync({ state: 'reconnect_needed', last_failure: FAILURE, next_attempt_at: null }) },
      {
        label: 'Needs reconnection',
        tone: 'stopped',
        pulse: false,
        details: ['Please reconnect SimpleFIN in Settings', FAILURE_LINE],
      },
    ],
    [
      'a provider removed from the server, ahead of the state its link was left in',
      {
        provider_available: false,
        sync: createSync({ state: 'reconnect_needed', last_failure: FAILURE, next_attempt_at: null }),
      },
      { label: 'Provider unavailable', tone: 'review', pulse: false, details: ['Synced 1 hour ago', FAILURE_LINE] },
    ],
    [
      'a bank asking the user to sign in again',
      { sync: createSync({ state: 'bank_signin_needed', last_failure: FAILURE }) },
      {
        label: 'Needs bank sign-in',
        tone: 'stopped',
        pulse: false,
        details: ['The app checks again each day', FAILURE_LINE],
      },
    ],
    [
      'a refused sync, as a failure with its reason and nothing waiting',
      {
        sync: createSync({
          state: 'sync_stopped',
          next_attempt_at: null,
          last_failure: {
            at: '2026-10-05T14:00:00Z',
            reason: 'SimpleFIN refused the dates asked for. Use Sync now to try again',
          },
        }),
      },
      {
        label: 'Sync failure',
        tone: 'stopped',
        pulse: false,
        details: ['SimpleFIN refused the dates asked for. Use Sync now to try again', 'Synced 1 hour ago'],
      },
    ],
    [
      'a bank account to choose again',
      { state: 'choose_account', sync: createSync({ state: 'choose_account', next_attempt_at: null }) },
      { label: 'Choose bank account', tone: 'stopped', pulse: false, details: ['SimpleFIN now lists it differently'] },
    ],
    [
      // The attempt that found the bank account missing reads its absence as refused dates, a cause
      // the change of listing replaces, so it isn't shown beside it
      'a bank account to choose again, without the reason the attempt that found it gave',
      {
        state: 'choose_account',
        sync: createSync({
          state: 'choose_account',
          next_attempt_at: null,
          last_failure: {
            at: '2026-10-05T14:00:00Z',
            reason: 'SimpleFIN refused the dates asked for. Use Sync now to try again',
          },
        }),
      },
      { label: 'Choose bank account', tone: 'stopped', pulse: false, details: ['SimpleFIN now lists it differently'] },
    ],
    [
      'an import fetching, blinking with its count',
      { import: createImport(), sync: createSync({ state: 'importing', last_success_at: null }) },
      {
        label: 'Importing · 1 of 2',
        tone: 'working',
        pulse: true,
        details: ['Imports transactions from Jun 1, 2026 to today'],
      },
    ],
    [
      'a date range import fetching, naming its last day rather than today',
      {
        import: createImport({ requested_start: '2026-03-01' }),
        sync: createSync({ state: 'importing' }),
        range_import: {
          first_day: '2026-03-01',
          last_day: '2026-05-31',
          next_day: '2026-03-01',
          restores_dismissed: false,
        },
      },
      {
        label: 'Importing · 1 of 2',
        tone: 'working',
        pulse: true,
        details: ['Imports transactions from Mar 1, 2026 to May 31, 2026'],
      },
    ],
    [
      'an import waiting for linked accounts to join it, with its range and start time',
      {
        import: createImport(),
        sync: createSync({ state: 'importing', last_success_at: null, import_starts_at: '2026-10-05T20:30:00Z' }),
      },
      {
        label: 'Starts soon',
        tone: 'working',
        pulse: false,
        details: ['Imports transactions from Jun 1, 2026 to today', 'Starts at 4:30 p.m.'],
      },
    ],
    [
      "an import waiting on the request budget, steady, with its next part's time",
      {
        import: createImport({ state: 'waiting_on_budget' }),
        sync: createSync({
          state: 'import_waiting_on_budget',
          last_success_at: null,
          next_attempt_at: '2026-10-05T20:30:00Z',
        }),
      },
      {
        label: 'Importing · 1 of 2',
        tone: 'working',
        pulse: false,
        details: ['Next part at 4:30 p.m., once SimpleFIN allows another request'],
      },
    ],
    [
      'a sync paused for review',
      { sync: createSync({ state: 'paused', paused: true, waiting_new_count: 105, next_attempt_at: null }) },
      { label: 'Paused · 105 new to review', tone: 'review', pulse: false, details: ['Resumes at 50 or fewer'] },
    ],
    [
      'a sync under way, blinking',
      { sync: createSync({ state: 'syncing' }) },
      { label: 'Syncing', tone: 'working', pulse: true, details: ['Last synced 1 hour ago'] },
    ],
    [
      'a review backlog nearing the pause',
      { sync: createSync({ state: 'review_warning', review_warning: true, waiting_new_count: 85 }) },
      {
        label: '85 new to review',
        tone: 'review',
        pulse: false,
        details: ['Sync pauses at 100', 'Next sync in 3 hours'],
      },
    ],
    [
      'a failed attempt waiting on its retry',
      { sync: createSync({ state: 'retrying', last_failure: FAILURE, next_attempt_at: '2026-10-05T16:30:00Z' }) },
      {
        label: 'Retrying at 12:30 p.m.',
        tone: 'working',
        pulse: false,
        details: ['Last attempt failed: Bank unavailable', 'Synced 1 hour ago'],
      },
    ],
  ])('words %s', (_, link, expected) => {
    expect(describeLink(createLink(link))).toEqual(expected)
  })

  it("times a retry by the user's day, west of UTC, giving the date only when it falls on another day", () => {
    // 7 p.m. in Toronto, when UTC has already reached Oct 6
    vi.setSystemTime(new Date('2026-10-05T23:00:00Z'))
    const retrying = (at: string) =>
      createLink({ sync: createSync({ state: 'retrying', last_failure: FAILURE, next_attempt_at: at }) })

    expect(describeLink(retrying('2026-10-06T01:00:00Z')).label).toBe('Retrying at 9:00 p.m.')
    expect(describeLink(retrying('2026-10-06T13:00:00Z')).label).toBe('Retrying at Oct 6, 9:00 a.m.')
  })

  it("says SimpleFIN's own limit holds the next sync once SimpleFIN has said its quota is spent", () => {
    const link = createLink({ sync: createSync({ waiting_on_budget: true, held_by_provider: true }) })

    expect(describeLink(link).details).toEqual(["Next sync is waiting on SimpleFIN's request limit"])
  })
})

describe('describeImportHeading', () => {
  it('describes a first link importing from its start, then imported', () => {
    expect(describeImportHeading(createImport())).toBe('Importing from Jun 1, 2026')
    expect(describeImportHeading(createImport({ state: 'complete' }))).toBe('Imported from Jun 1, 2026')
  })

  it('describes a relink catching up since the unlink, then caught up', () => {
    expect(describeImportHeading(createImport({ kind: 'relink' }))).toBe('Catching up since the unlink')
    expect(describeImportHeading(createImport({ kind: 'relink', state: 'complete' }))).toBe(
      'Caught up since the unlink',
    )
  })

  it('describes a bank account chosen again catching up from its new start', () => {
    expect(describeImportHeading(createImport({ kind: 'choose_again', requested_start: '2026-09-15' }))).toBe(
      'Catching up from Sep 15, 2026',
    )
  })
})
