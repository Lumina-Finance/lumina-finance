/**
 * Tests what the bank connections section says about a connection, so a rewrite catches a bank named
 * twice for its sign-in, a search that misses a linked account's name, a confirmation that counts
 * wrongly or reads "1 accounts", a connection read partway through its claim taken as added, an
 * institution limit applied where linking stays allowed, and a bank account shown both linked and
 * under Mismatch detected
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BankConnection, BankProvider, ConnectionBankAccount, CredentialField } from '@/api/bank-sync'
import {
  buildAuthorizationStart,
  countLinkedBankAccounts,
  countRequestsLeft,
  describeConnectionStatus,
  describeInstitutionAllowance,
  describeLinkingHeld,
  describeMismatch,
  describeRequestBudget,
  describeCredentialLength,
  getCredentialProblems,
  getNicknameProblem,
  describeSignInDetail,
  groupInstitutions,
  isClaimSettled,
  markServerRefusal,
  matchesConnectionSearch,
  matchesInstitutionSearch,
  readDroppedCredentialFile,
  submitsCredential,
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

const SETUP_TOKEN: CredentialField = {
  key: 'setup_token',
  label: 'Setup token',
  placeholder: 'Paste the token',
  max_length: 2048,
}

function provider(overrides: Partial<BankProvider> = {}): BankProvider {
  return {
    id: 'simplefin',
    name: 'SimpleFIN',
    site: 'SimpleFIN Bridge',
    description: 'Every bank you add in SimpleFIN Bridge',
    in_beta: false,
    credential_fields: [SETUP_TOKEN],
    connect_steps: [],
    connects_from: 'settings',
    offered: true,
    advertises_history: false,
    institution_limit: null,
    institutions_in_use: [],
    ...overrides,
  }
}

const accountNames: Record<string, string> = { everyday: 'Everyday', travel: 'Travel' }
const accountNameFor = (accountId: string) => accountNames[accountId]

// Two linked bank accounts behind one Harbour login, both waiting on its sign-in
const HARBOUR = [
  bankAccount({ external_id: 'ACT-chequing', linked_account_id: 'everyday', signin_needed: true }),
  bankAccount({ external_id: 'ACT-visa', name: 'Rewards Visa', linked_account_id: 'travel', signin_needed: true }),
  bankAccount({
    external_id: 'ACT-miles',
    name: 'Flight Miles',
    currency: 'https://example.com/miles',
    custom_currency: true,
  }),
]
const TIDEWATER = [
  bankAccount({
    external_id: 'ACT-savings',
    name: 'High Interest Savings',
    institution_name: 'Tidewater Credit Union',
    signin_needed: true,
  }),
]

describe('credential field keys', () => {
  const press = (
    key: string,
    modifiers: Partial<Record<'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing', boolean>> = {},
  ) =>
    submitsCredential({
      key,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
      ...modifiers,
    })

  it('connects on a plain Enter, since a token is one line', () => {
    expect(press('Enter')).toBe(true)
  })

  it('leaves Enter with a modifier or mid-composition, and every other key, to the field', () => {
    expect(press('Enter', { shiftKey: true })).toBe(false)
    expect(press('Enter', { altKey: true })).toBe(false)
    expect(press('Enter', { ctrlKey: true })).toBe(false)
    expect(press('Enter', { metaKey: true })).toBe(false)
    expect(press('Enter', { isComposing: true })).toBe(false)
    expect(press('a')).toBe(false)
  })
})

describe('bank connection status', () => {
  it('reads OK when nothing needs the user', () => {
    expect(describeConnectionStatus(connection({ accounts: [bankAccount({})] }))).toEqual({ tone: 'ok', label: 'OK' })
  })

  it('reads Bank sign-in needed and names each institution waiting on one once', () => {
    const signedOut = connection({ accounts: [...HARBOUR, ...TIDEWATER] })

    expect(describeConnectionStatus(signedOut)).toEqual({ tone: 'stopped', label: 'Needs bank sign-in' })
    expect(describeSignInDetail(signedOut)).toBe(
      'Please sign in to Harbour Bank and Tidewater Credit Union again in SimpleFIN Bridge. The app checks again each day.',
    )
  })

  it('reads Reconnect needed for a rejected connection', () => {
    expect(
      describeConnectionStatus(connection({ status: 'credential_rejected', accounts: [bankAccount({})] })),
    ).toEqual({
      tone: 'stopped',
      label: 'Needs reconnection',
    })
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
    expect(matchesConnectionSearch(nicknamed, 'tidewater', accountNameFor)).toBe(false)
  })
})

describe('bank connection claims', () => {
  it('takes a connection as added once its bank accounts are listed or a listing is due, never partway', () => {
    expect(isClaimSettled(connection({ accounts: [bankAccount({})] }))).toBe(true)
    expect(isClaimSettled(connection({ discovery_pending: true }))).toBe(true)
    expect(isClaimSettled(connection())).toBe(false)
  })
})

describe('bank connection requests', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts the requests left out of the cap', () => {
    expect(
      countRequestsLeft(
        connection({ request_budget: { limit: 20, used: 3, available_again_at: null, held_by_provider: false } }),
      ),
    ).toEqual({ left: 17, limit: 20 })
  })

  it('counts none left, never below none, once the provider holds requests back', () => {
    expect(
      countRequestsLeft(
        connection({ request_budget: { limit: 20, used: 21, available_again_at: null, held_by_provider: true } }),
      ),
    ).toEqual({ left: 0, limit: 20 })
  })

  it('counts nothing for a provider no longer available', () => {
    expect(
      countRequestsLeft(
        connection({ request_budget: { limit: null, used: 0, available_again_at: null, held_by_provider: false } }),
      ),
    ).toBeNull()
  })

  it('names the cap Lumina Finance keeps each connection under', () => {
    expect(
      describeRequestBudget(
        connection({ request_budget: { limit: 20, used: 3, available_again_at: null, held_by_provider: false } }),
      ),
    ).toBe("20 requests a day per connection, shared by every linked account's syncs.")
  })

  it('counts a cap of one in the singular', () => {
    expect(
      describeRequestBudget(
        connection({ request_budget: { limit: 1, used: 0, available_again_at: null, held_by_provider: false } }),
      ),
    ).toContain('1 request a day')
  })

  it('says when automatic syncs pick up once the requests are spent', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'))

    expect(
      describeRequestBudget(
        connection({
          request_budget: { limit: 20, used: 20, available_again_at: '2026-10-05T16:00:00Z', held_by_provider: false },
        }),
      ),
    ).toMatch(/ The next one frees up in 4 hours\.$/)
  })
})

describe('bank connection institutions', () => {
  it('counts institutions in use against no limit, and says the provider may set its own', () => {
    expect(describeInstitutionAllowance(provider({ institutions_in_use: ['Harbour Bank'] }), 'SimpleFIN')).toEqual({
      value: '1 · no limit',
      hint: 'Counts each institution with a linked bank account once, across all your SimpleFIN connections. Lumina Finance sets no limit, though SimpleFIN may set one.',
    })
  })

  it('counts institutions in use against a limit, without speaking of none', () => {
    const allowance = describeInstitutionAllowance(
      provider({ institution_limit: 3, institutions_in_use: ['Harbour Bank'] }),
      'SimpleFIN',
    )

    expect(allowance.value).toBe('1 of 3')
    expect(allowance.hint).not.toContain('no limit')
  })

  it('gathers bank accounts by institution with their sign-ins and linked counts', () => {
    const groups = groupInstitutions(connection({ accounts: [...HARBOUR, ...TIDEWATER] }), {
      institutionLimit: null,
      institutionsInUse: [],
    })

    expect(
      groups.map(({ name, signInNeeded, overLimit, linked, bankAccounts }) => [
        name,
        signInNeeded,
        overLimit,
        linked,
        bankAccounts.length,
      ]),
    ).toEqual([
      ['Harbour Bank', true, false, 2, 3],
      ['Tidewater Credit Union', true, false, 0, 1],
    ])
  })
})

describe('an institution over a reached limit', () => {
  type Allowance = Parameters<typeof groupInstitutions>[1]
  const reached: Allowance = { institutionLimit: 1, institutionsInUse: ['Harbour Bank'] }

  /** Whether Tidewater, holding the given bank accounts, is over the limit on a connection otherwise as given */
  function tidewaterOverLimit(
    accounts: ConnectionBankAccount[],
    overrides: Partial<BankConnection> = {},
    allowance: Allowance = reached,
  ): boolean {
    const [tidewater] = groupInstitutions(connection({ accounts, ...overrides }), allowance)
    return tidewater.overLimit
  }

  it('is a new institution with a free bank account on an active connection', () => {
    expect(tidewaterOverLimit(TIDEWATER)).toBe(true)
  })

  it('is not one already in use', () => {
    expect(
      tidewaterOverLimit(TIDEWATER, {}, { institutionLimit: 1, institutionsInUse: ['Tidewater Credit Union'] }),
    ).toBe(false)
  })

  it('is not one below the limit', () => {
    expect(tidewaterOverLimit(TIDEWATER, {}, { institutionLimit: 2, institutionsInUse: ['Harbour Bank'] })).toBe(false)
  })

  it('is not one without a limit', () => {
    expect(tidewaterOverLimit(TIDEWATER, {}, { institutionLimit: null, institutionsInUse: ['Harbour Bank'] })).toBe(
      false,
    )
  })

  it('is not one whose bank accounts are all linked', () => {
    expect(tidewaterOverLimit([{ ...TIDEWATER[0], linked_account_id: 'travel' }])).toBe(false)
  })

  it('is not one whose only free bank account is in a custom currency', () => {
    expect(
      tidewaterOverLimit([{ ...TIDEWATER[0], currency: 'https://example.com/miles', custom_currency: true }]),
    ).toBe(false)
  })

  it('is not one on a rejected connection, since it links nothing until it is back', () => {
    expect(tidewaterOverLimit(TIDEWATER, { status: 'credential_rejected' })).toBe(false)
  })
})

describe('bank connection institution search and mismatches', () => {
  // Rewards Visa's currency changed, so Travel's link to it waits to choose its bank account again
  const currencyChanged = connection({
    accounts: [
      bankAccount({ external_id: 'ACT-visa', name: 'Rewards Visa', currency: 'USD', linked_account_id: 'travel' }),
      bankAccount({ external_id: 'ACT-chequing', linked_account_id: 'everyday' }),
    ],
    choose_again_links: [{ account_id: 'travel', external_account_name: 'Rewards Visa' }],
  })

  it('lists a bank account whose link waits to choose it again as not linked, leaving it to Mismatch detected', () => {
    const [harbour] = groupInstitutions(currencyChanged, { institutionLimit: null, institutionsInUse: [] })

    expect(harbour.linked).toBe(1)
    expect(harbour.bankAccounts.map((bankAccount) => bankAccount.linked_account_id)).toEqual([null, 'everyday'])
  })

  it('counts a bank account whose link waits to choose it again as not linked, for the row and the modal', () => {
    expect(countLinkedBankAccounts(currencyChanged)).toEqual({ linked: 1, total: 2 })
  })

  it('finds an institution by its name or one of its bank accounts', () => {
    const [harbour] = groupInstitutions(connection({ accounts: HARBOUR }), {
      institutionLimit: null,
      institutionsInUse: [],
    })

    expect(matchesInstitutionSearch(harbour, ' HARBOUR ')).toBe(true)
    expect(matchesInstitutionSearch(harbour, 'flight')).toBe(true)
    expect(matchesInstitutionSearch(harbour, 'tidewater')).toBe(false)
  })

  it('names the bank account and its account when one link waits to choose it again', () => {
    const one = connection({ choose_again_links: [{ account_id: 'travel', external_account_name: 'Old Visa' }] })

    expect(describeMismatch(one, accountNameFor)).toBe(
      "SimpleFIN now lists Old Visa differently. Please choose Travel's bank account again to resume syncing.",
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
      "SimpleFIN now lists some bank accounts differently. Please choose each affected account's bank account again to resume syncing.",
    )
  })
})

describe('describeCredentialLength', () => {
  it("refuses a pasted value over its field's limit in the field's own words and keeps one at the limit", () => {
    expect(describeCredentialLength(SETUP_TOKEN, 'SimpleFIN Bridge', 'a'.repeat(2048))).toBeNull()
    expect(describeCredentialLength(SETUP_TOKEN, 'SimpleFIN Bridge', 'a'.repeat(2049))).toBe(
      'That setup token is too long. Please copy only the setup token from SimpleFIN Bridge and try again',
    )
  })

  it('keeps a name in capitals as the provider wrote it', () => {
    const field: CredentialField = { key: 'api_key', label: 'API key', placeholder: '', max_length: 4 }
    expect(describeCredentialLength(field, 'Fake Bank Online', 'abcde')).toBe(
      'That API key is too long. Please copy only the API key from Fake Bank Online and try again',
    )
  })
})

describe('readDroppedCredentialFile', () => {
  const PRIVATE_KEY = {
    key: 'private_key',
    label: 'Private key',
    placeholder: '',
    max_length: 60,
    file_extension: '.pem',
  }
  const KEY_TEXT = '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----'

  it('fills the field with the text of the one file dropped, trimmed, whatever case its extension takes', async () => {
    await expect(readDroppedCredentialFile(PRIVATE_KEY, [new File([`${KEY_TEXT}\n`], 'app.PEM')])).resolves.toEqual({
      value: KEY_TEXT,
    })
  })

  it('takes a file at the largest size it reads whose text, trimmed, is exactly as long as the field takes', async () => {
    const padded = `${' '.repeat(90)}${'a'.repeat(60)}${' '.repeat(90)}`
    expect(padded).toHaveLength(240)
    await expect(readDroppedCredentialFile(PRIVATE_KEY, [new File([padded], 'app.pem')])).resolves.toEqual({
      value: 'a'.repeat(60),
    })
  })

  it.each([
    ['no file', [], 'Please drop one .pem file'],
    ['two files', [new File([KEY_TEXT], 'a.pem'), new File([KEY_TEXT], 'b.pem')], 'Please drop one .pem file'],
    ['a file of another kind', [new File([KEY_TEXT], 'key.txt')], 'Please drop a .pem file'],
    [
      'a file holding more than the field takes',
      [new File(['a'.repeat(61)], 'app.pem')],
      'That file is too long to be the private key',
    ],
    [
      'a file too large to read for the field',
      [new File(['a'.repeat(241)], 'app.pem')],
      'That file is too long to be the private key',
    ],
  ])('refuses %s with the message the field shows', async (_case, files, error) => {
    await expect(readDroppedCredentialFile(PRIVATE_KEY, files)).resolves.toEqual({ error })
  })

  it('says a file the browser fails to read could not be read', async () => {
    const file = new File([KEY_TEXT], 'app.pem')
    vi.spyOn(file, 'text').mockRejectedValue(new DOMException('NotReadableError'))
    await expect(readDroppedCredentialFile(PRIVATE_KEY, [file])).resolves.toEqual({
      error: "That file couldn't be read",
    })
  })
})

describe('getCredentialProblems', () => {
  it('counts a pasted value over its limit as its field’s problem, so a press on Connect is refused', () => {
    expect(getCredentialProblems([SETUP_TOKEN], { [SETUP_TOKEN.key]: 'a'.repeat(2049) }, 'SimpleFIN Bridge')).toEqual({
      [SETUP_TOKEN.key]:
        'That setup token is too long. Please copy only the setup token from SimpleFIN Bridge and try again',
    })
  })

  it('asks for a value left empty, and finds nothing wrong with one that fits', () => {
    const accountId: CredentialField = { key: 'account_id', label: 'Account ID', placeholder: '', max_length: 20 }

    expect(getCredentialProblems([SETUP_TOKEN], { [SETUP_TOKEN.key]: '' }, 'SimpleFIN Bridge')).toEqual({
      [SETUP_TOKEN.key]: 'Paste the setup token',
    })
    expect(
      getCredentialProblems([SETUP_TOKEN, accountId], { [SETUP_TOKEN.key]: 'abc', account_id: '' }, 'Bank'),
    ).toEqual({
      account_id: 'Fill this in',
    })
  })
})

describe('getNicknameProblem', () => {
  it('refuses a nickname past the limit with a message rather than cutting it off, and keeps one at the limit', () => {
    expect(getNicknameProblem('a'.repeat(64))).toBeUndefined()
    expect(getNicknameProblem('a'.repeat(65))).toBe('Nickname must be 64 characters or less.')
  })

  it('measures the nickname as it is sent, trimmed, and lets a blank one clear it', () => {
    expect(getNicknameProblem(`  ${'a'.repeat(64)}  `)).toBeUndefined()
    expect(getNicknameProblem('')).toBeUndefined()
  })
})

describe('a connection whose provider was removed from the server', () => {
  const gone = connection({
    provider_available: false,
    status: 'credential_rejected',
    accounts: HARBOUR,
    request_budget: { limit: null, used: 0, available_again_at: null, held_by_provider: false },
  })

  it('reads Provider unavailable ahead of any other state', () => {
    expect(describeConnectionStatus(gone)).toEqual({ tone: 'review', label: 'Provider unavailable' })
  })

  it('says no requests go out rather than counting a cap', () => {
    expect(describeRequestBudget(gone)).toBe('No requests while the provider is unavailable.')
  })
})

describe('describeLinkingHeld', () => {
  const group = (overLimit: boolean) => ({
    name: 'Harbour Bank',
    signInNeeded: false,
    overLimit,
    linked: 0,
    bankAccounts: [],
  })
  const held = (
    overrides: Partial<BankConnection> = {},
    { linkingPaused = false, overLimit = false, institutionLimit = null as number | null } = {},
  ) =>
    describeLinkingHeld({
      linkingPaused,
      connection: connection(overrides),
      group: group(overLimit),
      institutionLimit,
    })

  it('gives no reason where linking can be used', () => {
    expect(held()).toBeUndefined()
  })

  it('gives each faded dropdown the reason its state calls for', () => {
    expect(held({}, { linkingPaused: true })).toBe("Bank sync isn't set up on this server yet.")
    expect(held({ status: 'credential_rejected' })).toBe('Please reconnect this connection to link an account.')
    expect(held({}, { overLimit: true, institutionLimit: 2 })).toBe(
      'Linking here would go over your limit of 2 institutions.',
    )
  })

  it('names bank sync first when the connection is rejected too', () => {
    expect(held({ status: 'credential_rejected' }, { linkingPaused: true })).toBe(
      "Bank sync isn't set up on this server yet.",
    )
  })
})

describe('buildAuthorizationStart', () => {
  it('sends a new connection with its nickname and the account whose link flow sent the user', () => {
    expect(
      buildAuthorizationStart({
        provider: 'signin_bank',
        credentials: { application_key: 'k' },
        nickname: 'Joint',
        returnToAccountId: 'account-1',
      }),
    ).toEqual({
      provider: 'signin_bank',
      credentials: { application_key: 'k' },
      nickname: 'Joint',
      return_account_id: 'account-1',
    })
  })

  it('names the connection being reconnected and leaves out the nickname it keeps', () => {
    expect(
      buildAuthorizationStart({
        provider: 'signin_bank',
        credentials: { application_key: 'k' },
        nickname: '',
        reconnectingId: 'connection-1',
      }),
    ).toEqual({ provider: 'signin_bank', credentials: { application_key: 'k' }, connection_id: 'connection-1' })
  })
})

describe('markServerRefusal', () => {
  const keys = ['application_id', 'private_key', 'country', 'bank']

  it('marks only the fields a refusal names, with its message on the last of them as the form draws them', () => {
    expect(markServerRefusal(keys, ['bank', 'country'])).toEqual({
      marked: new Set(['country', 'bank']),
      messageOn: 'bank',
    })
  })

  it.each([
    ['names no field', undefined],
    ['names only fields the form lacks', ['nickname']],
  ])('marks every field, with the message on the last, when the refusal %s', (_case, refusedFields) => {
    expect(markServerRefusal(keys, refusedFields)).toEqual({ marked: new Set(keys), messageOn: 'bank' })
  })
})
