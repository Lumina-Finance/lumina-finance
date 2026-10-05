/**
 * Tests how the link flow words itself from the account's own link and the user's connections, so a
 * rewrite catches an account linked before reading as a first link, from settings as much as from the
 * account, a link waiting for its bank account titled as a reconnect, the old bank account missing
 * from the comparison, and a dead end sending the user to Settings when nothing there can help
 */
import { describe, expect, it } from 'vitest'
import {
  LINK_FLOW_WORDING,
  describeConnectFirst,
  findPreviousBankAccount,
  getLinkFlowMode,
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
  provider: 'simplefin' as const,
  provider_name: 'SimpleFIN',
  external_account_id: 'ACT-gone',
  external_account_name: 'Rewards Visa',
  institution_name: 'Harbour Bank',
  import_start: '2026-06-01',
  linked_at: '2026-06-02T12:00:00Z',
  state: 'choose_account' as const,
  import: null,
}

describe('the link flow wording', () => {
  it('links an account never linked, relinks one unlinked before, and chooses again for a link waiting on its bank account', () => {
    const wording = [
      createStatus(),
      createStatus({ previous_link: PREVIOUS_LINK }),
      createStatus({ link: WAITING_LINK }),
    ].map((status) => LINK_FLOW_WORDING[getLinkFlowMode(status)])

    expect(wording).toEqual([
      { title: 'Link bank account', submitLabel: 'Link and import', confirmation: 'Linked. Importing history now.' },
      { title: 'Reconnect bank account', submitLabel: 'Relink', confirmation: 'Relinked. Catching up now.' },
      { title: 'Choose bank account again', submitLabel: 'Relink', confirmation: 'Relinked. Catching up now.' },
    ])
  })

  it('compares the listed bank accounts with the one unlinked, or the one the waiting link followed', () => {
    expect(findPreviousBankAccount(createStatus())).toBeNull()
    expect(findPreviousBankAccount(createStatus({ previous_link: PREVIOUS_LINK }))).toEqual({
      externalAccountId: 'ACT-old', name: 'Everyday Account', institution: 'CommBank', providerName: 'SimpleFIN',
    })
    expect(findPreviousBankAccount(createStatus({ link: WAITING_LINK }))).toEqual({
      externalAccountId: 'ACT-gone', name: 'Rewards Visa', institution: 'Harbour Bank', providerName: 'SimpleFIN',
    })
  })
})

describe('the link flow without a working connection', () => {
  it('sends a user with none to Settings to add one', () => {
    expect(describeConnectFirst([], createProviders())).toEqual({
      message: 'Add a bank connection in Settings first. One connection reaches every bank account you hold with that provider, and each account then chooses one of them here.',
      canOpenSettings: true,
    })
  })

  it('sends a user whose connection was rejected to Settings to reconnect it, even with no provider taking new connections', () => {
    expect(describeConnectFirst([createConnection({ status: 'credential_rejected' })], createProviders(false))).toEqual({
      message: 'Your bank connection needs a new setup token before it can link accounts. Reconnect it in Settings, then come back here.',
      canOpenSettings: true,
    })
  })

  it('only closes when no provider takes new connections and there is nothing to reconnect', () => {
    expect(describeConnectFirst([], createProviders(false))).toEqual({
      message: 'No bank provider is open to new connections right now, so there is nothing to link this account to yet.',
      canOpenSettings: false,
    })
  })
})
