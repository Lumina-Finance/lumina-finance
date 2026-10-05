/**
 * Covers whether an account's page shows bank sync, the account's bank sync as its page labels it,
 * from the link alone, and the import heading for each reason an import runs
 *
 * These tests catch bank sync shown to a user the deployment lets link nothing, a linked account's
 * link hidden once the user may no longer link, a group account read as linkable, a failed read shown
 * as still checking, an account waiting for its bank account to be chosen again shown as syncing, a
 * waiting import blinking as if it were fetching, and a relink's catch-up described as an import from
 * the link's first day
 */
import { describe, expect, it } from 'vitest'
import { describeBankSync, describeImportHeading, showsBankSync } from '@/pages/accounts/detail/components/bank-link/status'
import { createImport, createLink, createPreviousLink, createProviders, createStatus } from './fixtures'

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

describe('describeBankSync', () => {
  it('labels an account that is not the user own personal one as manual only', () => {
    expect(describeBankSync(false, undefined, false)).toEqual({ label: 'Manual only', tone: 'off', pulse: false })
  })

  it('says it is checking until the link is read, and that it could not check once the read fails', () => {
    expect(describeBankSync(true, undefined, false)).toEqual({ label: 'Checking…', tone: 'off', pulse: false })
    expect(describeBankSync(true, undefined, true)).toEqual({ label: "Couldn't check", tone: 'off', pulse: false })
  })

  it('labels an account without a live link as not linked, whether or not it was linked before', () => {
    expect(describeBankSync(true, createStatus(), false).label).toBe('Not linked')
    expect(describeBankSync(true, createStatus({ previous_link: createPreviousLink() }), false).label).toBe('Not linked')
  })

  it('stops on an account waiting for its bank account to be chosen again', () => {
    const status = createStatus({ link: createLink({ state: 'choose_account' }) })
    expect(describeBankSync(true, status, false)).toEqual({ label: 'Choose bank account', tone: 'stopped', pulse: false })
  })

  it('counts the import windows, blinking only while the import fetches', () => {
    const running = createStatus({ link: createLink({ import: createImport() }) })
    expect(describeBankSync(true, running, false)).toEqual({ label: 'Importing · 1 of 2', tone: 'working', pulse: true })

    for (const state of ['waiting', 'waiting_on_budget'] as const) {
      const waiting = createStatus({ link: createLink({ import: createImport({ state }) }) })
      expect(describeBankSync(true, waiting, false)).toEqual({ label: 'Importing · 1 of 2', tone: 'working', pulse: false })
    }
  })

  it('labels a link with no import running as linked', () => {
    expect(describeBankSync(true, createStatus({ link: createLink() }), false)).toEqual({ label: 'Linked', tone: 'ok', pulse: false })
  })
})

describe('describeImportHeading', () => {
  it('describes a first link importing from its start, then imported', () => {
    expect(describeImportHeading(createImport())).toBe('Importing from Jun 1, 2026')
    expect(describeImportHeading(createImport({ state: 'complete' }))).toBe('Imported from Jun 1, 2026')
  })

  it('describes a relink catching up since the unlink, then caught up', () => {
    expect(describeImportHeading(createImport({ kind: 'relink' }))).toBe('Catching up since the account was unlinked')
    expect(describeImportHeading(createImport({ kind: 'relink', state: 'complete' }))).toBe('Caught up since the account was unlinked')
  })

  it('describes a bank account chosen again catching up from its new start', () => {
    expect(describeImportHeading(createImport({ kind: 'choose_again', requested_start: '2026-09-15' }))).toBe('Catching up from Sep 15, 2026')
  })
})
