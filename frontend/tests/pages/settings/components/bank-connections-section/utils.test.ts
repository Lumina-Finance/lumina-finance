/**
 * Tests what the bank connections section says about a connection, so a rewrite catches a sign-in
 * shown on a rejected connection, a search that misses a linked account's name, a confirmation that
 * counts wrongly or reads "1 accounts", and an institution limit applied where linking stays allowed
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BankConnection, BankProvider, ConnectionBankAccount, ReconnectConnectionResult } from '@/api/bank-sync'
import {
  connectionName,
  countLinked,
  describeConnected,
  describeConnectionStatus,
  describeDisconnected,
  describeInstitutionAllowance,
  describeMismatch,
  describeReconnected,
  describeRequestBudget,
  describeSignInDetail,
  groupInstitutions,
  matchesConnectionSearch,
  matchesInstitutionSearch,
} from '@/pages/settings/components/bank-connections-section/utils'

function bankAccount(overrides: Partial<ConnectionBankAccount>): ConnectionBankAccount {
  return {
    external_id: 'ACT-chequing',
    name: 'Everyday Chequing',
    institution_name: 'Harbour Bank',
    currency: 'CAD',
    custom_currency: false,
    linked_account_id: null,
    eligible_account_ids: [],
    signin_needed: false,
    ...overrides,
  }
}

function connection(overrides: Partial<BankConnection> = {}): BankConnection {
  return {
    id: 'connection-1',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    nickname: null,
    server_label: 'bridge.simplefin.org',
    created_at: '2026-10-01T15:00:00Z',
    status: 'active',
    accounts: [],
    choose_again_links: [],
    discovery_pending: false,
    request_budget: { limit: 20, used: 0, available_again_at: null },
    ...overrides,
  }
}

function provider(overrides: Partial<BankProvider> = {}): BankProvider {
  return {
    id: 'simplefin',
    name: 'SimpleFIN',
    description: 'Every bank you add in SimpleFIN Bridge',
    connects_from: 'settings',
    offered: true,
    history_limit_months: 12,
    advertises_history: false,
    institution_limit: null,
    institutions_in_use: [],
    ...overrides,
  }
}

const accountNames: Record<string, string> = { everyday: 'Everyday', travel: 'Travel' }
const accountNameFor = (accountId: string) => accountNames[accountId]

const HARBOUR = [
  bankAccount({ external_id: 'ACT-chequing', linked_account_id: 'everyday', signin_needed: true }),
  bankAccount({ external_id: 'ACT-visa', name: 'Rewards Visa' }),
  bankAccount({ external_id: 'ACT-miles', name: 'Flight Miles', currency: 'https://example.com/miles', custom_currency: true }),
]
const TIDEWATER = [
  bankAccount({ external_id: 'ACT-savings', name: 'High Interest Savings', institution_name: 'Tidewater Credit Union', signin_needed: true }),
]

describe('bank connection name and status', () => {
  it('names a connection by its nickname, or by its provider without one', () => {
    expect(connectionName(connection({ nickname: 'Joint banks' }))).toBe('Joint banks')
    expect(connectionName(connection())).toBe('SimpleFIN')
  })

  it('reads OK when nothing needs the user', () => {
    expect(describeConnectionStatus(connection({ accounts: [bankAccount({})] }))).toEqual({ tone: 'ok', label: 'OK' })
  })

  it('reads Bank sign-in needed and names every institution waiting on one', () => {
    const signedOut = connection({ accounts: [...HARBOUR, ...TIDEWATER] })

    expect(describeConnectionStatus(signedOut)).toEqual({ tone: 'stopped', label: 'Bank sign-in needed' })
    expect(describeSignInDetail(signedOut)).toBe(
      'Sign in to Harbour Bank and Tidewater Credit Union again in SimpleFIN Bridge. The app checks daily.',
    )
  })

  it('reads Reconnect needed for a rejected connection and holds back its sign-ins until it is back', () => {
    const rejected = connection({ status: 'credential_rejected', accounts: HARBOUR })

    expect(describeConnectionStatus(rejected)).toEqual({ tone: 'stopped', label: 'Reconnect needed' })
    expect(describeSignInDetail(rejected)).toBeNull()
  })

  it('counts the bank accounts linked to an account', () => {
    expect(countLinked(HARBOUR)).toBe(1)
  })
})

describe('bank connection search', () => {
  const nicknamed = connection({ nickname: 'Joint banks', accounts: HARBOUR })

  it.each([
    ['its nickname', 'joint'],
    ['its provider', 'simplefin'],
    ['its server', 'bridge.simplefin'],
    ['an institution', 'harbour'],
    ['a bank account', 'rewards visa'],
    ['the account a bank account is linked to', 'EVERYDAY'],
    ['anything, while the search is blank', '   '],
  ])('matches %s', (_, query) => {
    expect(matchesConnectionSearch(nicknamed, query, accountNameFor)).toBe(true)
  })

  it('matches nothing the connection does not show', () => {
    expect(matchesConnectionSearch(nicknamed, 'travel', accountNameFor)).toBe(false)
  })
})

describe('bank connection confirmations', () => {
  it('counts the bank accounts a new connection reaches', () => {
    expect(describeConnected(connection({ nickname: 'Joint banks', accounts: [...HARBOUR, ...TIDEWATER] }))).toBe(
      'Joint banks connected with 4 bank accounts. Link each one from the account it belongs to.',
    )
    expect(describeConnected(connection({ accounts: [bankAccount({})] }))).toBe(
      'SimpleFIN connected with 1 bank account. Link each one from the account it belongs to.',
    )
  })

  it('says the bank accounts are on the way when the claim could not list them yet', () => {
    expect(describeConnected(connection({ discovery_pending: true }))).toBe('SimpleFIN connected. Its bank accounts will appear here shortly.')
  })

  it('counts the accounts a reconnect resumes and those that need their bank account chosen again', () => {
    const result = (resumed: number, chooseAgain: number): ReconnectConnectionResult => ({
      connection: connection(),
      resumed_account_ids: Array.from({ length: resumed }, (_, index) => `resumed-${index}`),
      choose_again_account_ids: Array.from({ length: chooseAgain }, (_, index) => `choose-${index}`),
      accounts_pending: false,
    })

    expect(describeReconnected(result(2, 1))).toBe(
      'SimpleFIN reconnected. 2 accounts resume syncing. 1 account needs its bank account chosen again.',
    )
    expect(describeReconnected(result(1, 2))).toBe(
      'SimpleFIN reconnected. 1 account resumes syncing. 2 accounts need their bank accounts chosen again.',
    )
    expect(describeReconnected(result(0, 0))).toBe('SimpleFIN reconnected.')
  })

  it('says linked accounts wait on a listing when the reconnect could not list the bank accounts', () => {
    expect(describeReconnected({ connection: connection(), resumed_account_ids: [], choose_again_account_ids: [], accounts_pending: true })).toBe(
      'SimpleFIN reconnected. Linked accounts pick up once their bank accounts are listed again.',
    )
  })

  it('counts the accounts a disconnect unlinked, and leaves the count out when there were none', () => {
    const joint = connection({ nickname: 'Joint banks' })

    expect(describeDisconnected(joint, 2)).toBe(
      "Joint banks disconnected. 2 accounts unlinked. To stop SimpleFIN Bridge sharing data at all, revoke Lumina Finance's access there too.",
    )
    expect(describeDisconnected(joint, 0)).toBe(
      "Joint banks disconnected. To stop SimpleFIN Bridge sharing data at all, revoke Lumina Finance's access there too.",
    )
  })
})

describe('bank connection requests', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("names the cap Lumina Finance keeps each connection under, below the provider's own limit", () => {
    expect(describeRequestBudget(connection({ request_budget: { limit: 20, used: 3, available_again_at: null } }))).toBe(
      "Lumina Finance makes up to 20 requests a day for each connection, below SimpleFIN's daily limit. Automatic syncs and Sync now share them across every account linked through it.",
    )
  })

  it('counts a cap of one in the singular', () => {
    expect(describeRequestBudget(connection({ request_budget: { limit: 1, used: 0, available_again_at: null } }))).toContain('up to 1 request a day')
  })

  it('says when automatic syncs pick up once the requests are spent', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'))

    expect(describeRequestBudget(connection({ request_budget: { limit: 20, used: 20, available_again_at: '2026-10-05T16:00:00Z' } }))).toMatch(
      / Automatic syncs wait until one frees up in 4 hours\.$/,
    )
  })
})

describe('bank connection institutions', () => {
  const counted = 'Counts each institution with a linked bank account once, across all your SimpleFIN connections.'

  it('counts institutions in use against no limit, and says the provider may set its own', () => {
    expect(describeInstitutionAllowance(provider({ institutions_in_use: ['Harbour Bank'] }), 'SimpleFIN')).toEqual({
      value: '1 · no limit',
      hint: `${counted} Lumina Finance sets no limit on institutions for SimpleFIN, though SimpleFIN may set limits of its own.`,
    })
  })

  it('counts institutions in use against a limit', () => {
    expect(describeInstitutionAllowance(provider({ institution_limit: 3, institutions_in_use: ['Harbour Bank'] }), 'SimpleFIN')).toEqual({
      value: '1 of 3',
      hint: counted,
    })
  })

  it('gathers bank accounts by institution with their sign-ins and linked counts', () => {
    const groups = groupInstitutions(connection({ accounts: [...HARBOUR, ...TIDEWATER] }), { institutionLimit: null, institutionsInUse: [] })

    expect(groups.map(({ name, signInNeeded, overLimit, linked, bankAccounts }) => [name, signInNeeded, overLimit, linked, bankAccounts.length])).toEqual([
      ['Harbour Bank', true, false, 1, 3],
      ['Tidewater Credit Union', true, false, 0, 1],
    ])
  })

  it('holds back sign-ins on a rejected connection', () => {
    const groups = groupInstitutions(connection({ status: 'credential_rejected', accounts: HARBOUR }), { institutionLimit: null, institutionsInUse: [] })

    expect(groups.map((group) => group.signInNeeded)).toEqual([false])
  })

  it('marks only a new institution with a bank account to link as over a reached limit', () => {
    const fullyLinked = [bankAccount({ external_id: 'ACT-loan', name: 'Car Loan', institution_name: 'Northshore Bank', linked_account_id: 'travel' })]
    const groups = groupInstitutions(connection({ accounts: [...HARBOUR, ...fullyLinked, ...TIDEWATER] }), {
      institutionLimit: 1,
      institutionsInUse: ['Harbour Bank'],
    })

    expect(groups.map((group) => [group.name, group.overLimit])).toEqual([
      ['Harbour Bank', false],
      ['Northshore Bank', false],
      ['Tidewater Credit Union', true],
    ])
  })

  it('applies no limit below the number in use', () => {
    const groups = groupInstitutions(connection({ accounts: TIDEWATER }), { institutionLimit: 2, institutionsInUse: ['Harbour Bank'] })

    expect(groups.map((group) => group.overLimit)).toEqual([false])
  })

  it('finds an institution by its name or one of its bank accounts', () => {
    const [harbour] = groupInstitutions(connection({ accounts: HARBOUR }), { institutionLimit: null, institutionsInUse: [] })

    expect(matchesInstitutionSearch(harbour, ' HARBOUR ')).toBe(true)
    expect(matchesInstitutionSearch(harbour, 'flight')).toBe(true)
    expect(matchesInstitutionSearch(harbour, 'tidewater')).toBe(false)
  })

  it('names the bank account and its account when one link waits to choose it again', () => {
    const one = connection({ choose_again_links: [{ account_id: 'travel', external_account_name: 'Old Visa' }] })

    expect(describeMismatch(one, accountNameFor)).toBe(
      "SimpleFIN now lists Old Visa differently, so Lumina Finance can't tell whether it's the same account. Travel won't sync until you choose its bank account again.",
    )
  })

  it('speaks of the accounts together when several links wait to choose again', () => {
    const several = connection({
      choose_again_links: [
        { account_id: 'travel', external_account_name: 'Old Visa' },
        { account_id: 'everyday', external_account_name: 'Old Chequing' },
      ],
    })

    expect(describeMismatch(several, accountNameFor)).toBe(
      "SimpleFIN now lists some bank accounts differently, so Lumina Finance can't tell whether they're the same ones. Their accounts won't sync until you choose each one's bank account again.",
    )
  })
})
