/**
 * Tests how the link flow words itself from the account's own link and the user's connections, so a
 * rewrite catches an account linked before reading as a first link, from settings as much as from the
 * account, a link waiting for its bank account titled as a reconnect, the old bank account missing
 * from the comparison, a choice made again starting on another connection than its own, and a dead
 * end sending the user to Settings when nothing there can help
 */
import { describe, expect, it } from 'vitest'
import { NOTHING_TO_LINK_REASON } from '@/components/bank-link-flow/constants'
import {
  LINK_FLOW_WORDING,
  describeConnectFirst,
  findPreviousBankAccount,
  getLinkFlowMode,
  pickListedConnection,
} from '@/components/bank-link-flow/wording'
import { createConnection, createProviders, createStatus } from './fixtures'

const PREVIOUS_LINK = {
  provider_name: 'SimpleFIN',
  external_account_id: 'ACT-old',
  external_account_name: 'Everyday Account',
  institution_name: 'CommBank',
  unlinked_at: '2026-10-04T12:00:00Z',
}

const WAITING_LINK = {
  account_id: 'account-1',
  connection_id: 'connection-2',
  provider: 'simplefin',
  provider_name: 'SimpleFIN',
  provider_site: 'SimpleFIN Bridge',
  provider_available: true,
  external_account_id: 'ACT-gone',
  external_account_name: 'Rewards Visa',
  institution_name: 'Harbour Bank',
  import_start: '2026-06-01',
  linked_at: '2026-06-02T12:00:00Z',
  state: 'choose_account' as const,
  import: null,
  sync: {
    state: 'choose_account' as const,
    last_success_at: '2026-10-03T12:00:00Z',
    last_failure: null,
    next_attempt_at: null,
    waiting_on_budget: false,
    held_by_provider: false,
    sync_running: false,
    sync_requested: false,
    import_starts_at: null,
    waiting_new_count: 0,
    paused: false,
    review_warning: false,
  },
  history_reminder: null,
  cut_off_day: null,
  range_import: null,
  range_outcome: null,
}

describe('the link flow wording', () => {
  it('links an account never linked, relinks one unlinked before, and chooses again for a link waiting on its bank account', () => {
    const wording = [
      createStatus(),
      createStatus({ previous_link: PREVIOUS_LINK }),
      createStatus({ link: WAITING_LINK }),
    ].map((status) => LINK_FLOW_WORDING[getLinkFlowMode(status)])

    expect(wording).toEqual([
      {
        title: 'Link bank account',
        submitLabel: 'Link and import',
        confirmation: 'Link ready. Syncing starts soon.',
      },
      {
        title: 'Reconnect bank account',
        submitLabel: 'Relink',
        confirmation: 'Relink ready. Syncing starts soon.',
      },
      {
        title: 'Choose bank account again',
        submitLabel: 'Relink',
        confirmation: 'Relink ready. Syncing starts soon.',
      },
    ])
  })

  it('compares the listed bank accounts with the one unlinked, or the one the waiting link followed', () => {
    expect(findPreviousBankAccount(createStatus())).toBeNull()
    expect(findPreviousBankAccount(createStatus({ previous_link: PREVIOUS_LINK }))).toEqual({
      externalAccountId: 'ACT-old',
      name: 'Everyday Account',
      institution: 'CommBank',
      providerName: 'SimpleFIN',
    })
    expect(findPreviousBankAccount(createStatus({ link: WAITING_LINK }))).toEqual({
      externalAccountId: 'ACT-gone',
      name: 'Rewards Visa',
      institution: 'Harbour Bank',
      providerName: 'SimpleFIN',
    })
  })
})

describe('the connection the link flow lists', () => {
  const first = createConnection({ id: 'connection-1' })
  const second = createConnection({ id: 'connection-2' })

  it('starts on the first working connection', () => {
    expect(pickListedConnection([first, second], null, createStatus())).toBe(first)
  })

  it('starts a choice made again on the connection its waiting link came from', () => {
    expect(pickListedConnection([first, second], null, createStatus({ link: WAITING_LINK }))).toBe(second)
  })

  it('lists the connection the user switched to', () => {
    expect(pickListedConnection([first, second], 'connection-1', createStatus({ link: WAITING_LINK }))).toBe(first)
  })
})

describe('the link flow without a working connection', () => {
  it('sends a user with none to Settings to add one', () => {
    const connectFirst = describeConnectFirst([], createProviders())
    expect(connectFirst.canOpenSettings).toBe(true)
    expect(connectFirst.message).toContain('Please add a bank connection in Settings first.')
  })

  it('sends a user whose connection was rejected to Settings to reconnect it, even with no provider taking new connections', () => {
    const connectFirst = describeConnectFirst(
      [createConnection({ status: 'credential_rejected' })],
      createProviders(false),
    )
    expect(connectFirst.canOpenSettings).toBe(true)
    expect(connectFirst.message).toContain('Please reconnect in Settings')
  })

  it('only closes when no provider takes new connections and there is nothing to reconnect', () => {
    expect(describeConnectFirst([], createProviders(false))).toEqual({
      message: NOTHING_TO_LINK_REASON,
      canOpenSettings: false,
    })
  })
})
