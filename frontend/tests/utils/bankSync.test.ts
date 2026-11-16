/**
 * Tests the bank sync rules the settings section and the account's page share, so a rewrite catches a
 * group account, even the user's own, or another user's account read as one bank sync links, and a
 * disconnect that counts wrongly or reads "1 accounts"
 */
import { describe, expect, it } from 'vitest'
import type { BankConnection, ConnectionBankAccount, ReconnectConnectionResult } from '@/api/bank-sync'
import { ApiError } from '@/api/auth'
import {
  authorizationReturnTarget,
  credentialNoun,
  describeAuthorizationFailure,
  readAuthorizationReturn,
  describeAuthorizationReturn,
  describeConnected,
  describeDisconnected,
  describeDisconnectEffect,
  describeReconnected,
  fillRedirectUrl,
  isOwnPersonalAccount,
} from '@/utils/bankSync'

function bankAccount(external_id: string): ConnectionBankAccount {
  return {
    external_id,
    name: external_id,
    institution_name: 'Harbour Bank',
    currency: 'CAD',
    custom_currency: false,
    linked_account_id: null,
    eligible_account_ids: [],
    signin_needed: false,
  }
}

function connection(overrides: Partial<BankConnection> = {}): BankConnection {
  return {
    id: 'connection-1',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    provider_site: 'SimpleFIN Bridge',
    provider_available: true,
    nickname: null,
    server_label: 'bridge.simplefin.org',
    created_at: '2026-10-01T15:00:00Z',
    status: 'active',
    accounts: [],
    choose_again_links: [],
    discovery_pending: false,
    request_budget: { limit: 20, used: 0, available_again_at: null, held_by_provider: false },
    ...overrides,
  }
}

describe('isOwnPersonalAccount', () => {
  it('takes only an account the user owns outside any group', () => {
    expect(isOwnPersonalAccount({ owner_id: 'user-1', group_id: null }, 'user-1')).toBe(true)
    expect(isOwnPersonalAccount({ owner_id: 'user-1', group_id: 'group-1' }, 'user-1')).toBe(false)
    expect(isOwnPersonalAccount({ owner_id: 'user-2', group_id: null }, 'user-1')).toBe(false)
  })
})

describe('credentialNoun', () => {
  it('lowers a label written as a heading for use mid-sentence, and keeps one in capitals', () => {
    expect(credentialNoun('Setup token')).toBe('setup token')
    expect(credentialNoun('API key')).toBe('API key')
  })
})

describe('describeDisconnectEffect', () => {
  it('says before a disconnect which accounts it unlinks and what they keep', () => {
    expect(describeDisconnectEffect(2)).toBe(
      'Disconnecting unlinks 2 accounts but keeps their transactions and waiting items.',
    )
    expect(describeDisconnectEffect(1)).toBe(
      'Disconnecting unlinks 1 account but keeps its transactions and waiting items.',
    )
  })

  it('says nothing when nothing is linked through the connection', () => {
    expect(describeDisconnectEffect(0)).toBeNull()
  })
})

describe('describeDisconnected', () => {
  it('counts the accounts a disconnect unlinked, and leaves the count out when there were none', () => {
    const joint = connection({ nickname: 'Joint banks' })

    expect(describeDisconnected(joint, 2)).toContain('Disconnected from Joint banks and unlinked 2 accounts.')
    expect(describeDisconnected(joint, 1)).toContain(' and unlinked 1 account.')
    expect(describeDisconnected(joint, 0)).not.toContain('unlinked')
  })

  it('names the site to revoke access at, or the provider once it is removed and its site unknown', () => {
    expect(describeDisconnected(connection(), 0)).toContain('access in SimpleFIN Bridge to stop sharing data.')
    const gone = connection({ provider_site: null, provider_available: false })

    expect(describeDisconnected(gone, 0)).toContain('access in SimpleFIN to stop sharing data.')
    expect(describeDisconnected(gone, 0)).not.toContain('null')
  })
})

describe('describeConnected', () => {
  const four = ['a', 'b', 'c', 'd'].map(bankAccount)

  it('counts the bank accounts a new connection reaches, in the singular for one', () => {
    expect(describeConnected(connection({ nickname: 'Joint banks', accounts: four }))).toBe(
      "Connected to Joint banks with 4 bank accounts. Please link each bank account from the matching account's page.",
    )
    expect(describeConnected(connection({ accounts: [bankAccount('a')] }))).toContain(
      'Connected to SimpleFIN with 1 bank account.',
    )
  })

  it('says the bank accounts are on the way when the claim could not list them yet', () => {
    expect(describeConnected(connection({ discovery_pending: true }))).toBe(
      'Connected to SimpleFIN. Its bank accounts will appear here shortly.',
    )
  })

  it('leaves out where to link the bank accounts when going back to the link flow', () => {
    expect(describeConnected(connection({ nickname: 'Joint banks', accounts: four }), true)).toBe(
      'Connected to Joint banks with 4 bank accounts.',
    )
    expect(describeConnected(connection({ discovery_pending: true }), true)).toBe(
      'Connected to SimpleFIN. Its bank accounts will appear shortly.',
    )
  })
})

describe('describeReconnected', () => {
  const result = (resumed: number, chooseAgain: number): ReconnectConnectionResult => ({
    connection: connection(),
    resumed_account_ids: Array.from({ length: resumed }, (_, index) => `resumed-${index}`),
    choose_again_account_ids: Array.from({ length: chooseAgain }, (_, index) => `choose-${index}`),
    accounts_pending: false,
  })

  it('counts the accounts a reconnect resumes and those that need their bank account chosen again', () => {
    expect(describeReconnected(result(2, 1))).toBe(
      'Reconnected to SimpleFIN. Syncing resumes for 2 accounts. 1 account needs its bank account chosen again.',
    )
    expect(describeReconnected(result(1, 2))).toContain('Syncing resumes for 1 account.')
    expect(describeReconnected(result(1, 2))).toContain('2 accounts need their bank accounts chosen again.')
    expect(describeReconnected(result(0, 0))).toBe('Reconnected to SimpleFIN.')
  })

  it('says linked accounts wait on a listing when the reconnect could not list the bank accounts', () => {
    expect(describeReconnected({ ...result(0, 0), accounts_pending: true })).toBe(
      'Reconnected to SimpleFIN. Linked accounts pick up once their bank accounts are listed again.',
    )
  })
})

describe('fillRedirectUrl', () => {
  it('names the address the bank returns to, and leaves a step that does not mention it alone', () => {
    expect(fillRedirectUrl('Set the redirect URL to {redirect_url}.', 'https://app.example')).toBe(
      'Set the redirect URL to https://app.example/settings/bank-authorization.',
    )
    expect(fillRedirectUrl('Copy the key.', 'https://app.example')).toBe('Copy the key.')
  })
})

describe('describeAuthorizationReturn', () => {
  const returned = {
    return_account_id: null,
    connection: connection({ accounts: [bankAccount('a')] }),
    reconnection: null,
  }

  it('confirms a connection added, leaving out where to link when returning to the link flow', () => {
    expect(describeAuthorizationReturn({ ...returned, outcome: 'connected' })).toEqual({
      toast:
        "Connected to SimpleFIN with 1 bank account. Please link each bank account from the matching account's page.",
    })
    expect(describeAuthorizationReturn({ ...returned, outcome: 'connected', return_account_id: 'account-1' })).toEqual({
      toast: 'Connected to SimpleFIN with 1 bank account.',
    })
  })

  it('confirms a reconnection', () => {
    const reconnection = {
      connection: connection(),
      resumed_account_ids: ['a'],
      choose_again_account_ids: [],
      accounts_pending: false,
    }

    expect(describeAuthorizationReturn({ ...returned, outcome: 'reconnected', reconnection })).toEqual({
      toast: 'Reconnected to SimpleFIN. Syncing resumes for 1 account.',
    })
  })

  it('says nothing was added when the bank did not approve access', () => {
    expect(describeAuthorizationReturn({ ...returned, outcome: 'cancelled', connection: null })).toEqual({
      failure: "Nothing was added: your bank didn't approve access.",
    })
  })
})

describe('readAuthorizationReturn', () => {
  it('reads the state with the bank code, or with the bank error when it sent one', () => {
    expect(readAuthorizationReturn(new URLSearchParams('state=s1&code=c1'))).toEqual({ state: 's1', code: 'c1' })
    expect(readAuthorizationReturn(new URLSearchParams('state=s1&error=access_denied'))).toEqual({
      state: 's1',
      error: 'access_denied',
    })
  })

  it('reads the error alone when the bank sent both, so a refusal never claims a code', () => {
    expect(readAuthorizationReturn(new URLSearchParams('state=s1&code=c1&error=access_denied'))).toEqual({
      state: 's1',
      error: 'access_denied',
    })
  })

  it('reads nothing from a page opened without the state or without an answer', () => {
    expect(readAuthorizationReturn(new URLSearchParams('code=c1'))).toBeNull()
    expect(readAuthorizationReturn(new URLSearchParams('state=s1'))).toBeNull()
    expect(readAuthorizationReturn(new URLSearchParams(''))).toBeNull()
  })
})

describe('describeAuthorizationFailure', () => {
  it('says the sign-in ended when the server no longer knows it or the provider could not finish it', () => {
    expect(describeAuthorizationFailure(new ApiError('gone', 404, { detail: 'gone' }))).toContain('has ended')
    expect(describeAuthorizationFailure(new ApiError('provider', 502, { detail: 'provider' }))).toContain('has ended')
  })

  it("gives the server's own reason for any other refusal", () => {
    expect(describeAuthorizationFailure(new ApiError('This bank sign-in has expired.', 422, { detail: 'x' }))).toBe(
      'This bank sign-in has expired.',
    )
  })

  it('says the connection may have been added when the answer never reached the browser', () => {
    expect(describeAuthorizationFailure(new Error('Failed to fetch'))).toContain('may have been added')
    expect(describeAuthorizationFailure(new ApiError('Bad gateway', 502))).toContain('may have been added')
  })
})

describe('authorizationReturnTarget', () => {
  const connected = {
    outcome: 'connected',
    return_account_id: null,
    connection: connection(),
    reconnection: null,
  } as const

  it('goes back to the account link flow that started the sign-in, on the connection just made', () => {
    expect(authorizationReturnTarget({ ...connected, return_account_id: 'account-1' })).toEqual({
      to: 'link-flow',
      accountId: 'account-1',
      connectionId: 'connection-1',
    })
    const reconnection = {
      connection: connection({ id: 'connection-2' }),
      resumed_account_ids: [],
      choose_again_account_ids: [],
      accounts_pending: false,
    }
    expect(
      authorizationReturnTarget({
        outcome: 'reconnected',
        return_account_id: 'account-1',
        connection: null,
        reconnection,
      }),
    ).toEqual({ to: 'link-flow', accountId: 'account-1', connectionId: 'connection-2' })
  })

  it('goes to Settings when the sign-in started there', () => {
    expect(authorizationReturnTarget(connected)).toEqual({ to: 'settings' })
    expect(authorizationReturnTarget({ ...connected, outcome: 'cancelled', connection: null })).toEqual({
      to: 'settings',
    })
  })

  it("goes back to the account's link step when the bank did not approve access, with no connection to choose", () => {
    expect(
      authorizationReturnTarget({
        ...connected,
        outcome: 'cancelled',
        connection: null,
        return_account_id: 'account-1',
      }),
    ).toEqual({ to: 'link-flow', accountId: 'account-1', connectionId: null })
  })
})
