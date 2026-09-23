/**
 * Tests which existing account the import guesses for a source by name, now that the rule scoring
 * one name contained inside the other is what settles most of them, and what the guesser leaves
 * alone rather than choosing between
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { ImportAccountSource } from '@/pages/imports/types'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import { inferAccountMappings } from '@/pages/imports/utils'

/**
 * Creates a mapping source, defaulting to one rows are written to
 */
function createSource(id: string, overrides: Partial<ImportAccountSource> = {}): ImportAccountSource {
  return { id, label: id, matchText: id, isCounterpartyOnly: false, ...overrides }
}

/**
 * Creates an account overview, carrying only the fields the name match reads
 */
function createAccount(overrides: Partial<AccountsOverview> = {}): AccountsOverview {
  return {
    id: 'acct-1',
    owner_id: null,
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: 'Everyday',
    institution: null,
    currency: 'CAD',
    current_balance: 0,
    base_currency_current_balance: 0,
    current_balance_fx_status: { state: 'complete', missing_pairs: [] },
    credit_limit: null,
    can_write: true,
    is_archived: false,
    ...overrides,
  }
}

describe('guessing which account a source belongs to by name', () => {
  it('refuses to choose between two accounts sharing a name', () => {
    const source = createSource('Savings')
    const accounts = [
      createAccount({ id: 'acct-1', name: 'Savings' }),
      createAccount({ id: 'acct-2', name: 'Savings' }),
    ]

    expect(inferAccountMappings([source], {}, { rowAccounts: accounts, counterpartyAccounts: accounts })).toEqual({})
  })

  // Without the chequing-to-checking rewrite the two share only one word out of two, which fails
  // both the shared-word rule and the substring rule, so this genuinely fails if the rewrite goes
  it('matches an account spelling chequing the British way against one spelling it checking', () => {
    const source = createSource('Everyday Chequing')
    const accounts = [createAccount({ id: 'acct-1', name: 'Everyday Checking' })]

    expect(inferAccountMappings([source], {}, { rowAccounts: accounts, counterpartyAccounts: accounts }))
      .toEqual({ 'Everyday Chequing': 'acct-1' })
  })

  it('leaves a source and an account unmatched where both clean away to nothing', () => {
    const source = createSource('Transactions')
    const accounts = [createAccount({ id: 'acct-1', name: 'Statement' })]

    expect(inferAccountMappings([source], {}, { rowAccounts: accounts, counterpartyAccounts: accounts })).toEqual({})
  })

  it('fills in a stored blank answer but leaves a stored outside answer alone', () => {
    const sources = [createSource('Empty'), createSource('Outside', { isCounterpartyOnly: true })]
    const accounts = [createAccount({ id: 'acct-1', name: 'Empty' })]

    const result = inferAccountMappings(
      sources,
      { Empty: '', Outside: OUTSIDE_ACCOUNT_VALUE },
      { rowAccounts: accounts, counterpartyAccounts: accounts },
    )

    expect(result.Empty).toBe('acct-1')
    expect(result.Outside).toBe(OUTSIDE_ACCOUNT_VALUE)
  })
})

describe('cross-source account-name collisions', () => {
  const everyday = createAccount({ id: 'everyday', name: 'Everyday Chequing' })
  const collidingSources = [
    createSource('everyday-source', { label: 'Everyday Chequing', matchText: 'Everyday Chequing' }),
    createSource('card-one-source', {
      label: 'Everyday Chequing Card One',
      matchText: 'Everyday Chequing Card One',
    }),
    createSource('card-two-source', {
      label: 'Everyday Chequing Card Two',
      matchText: 'Everyday Chequing Card Two',
    }),
  ]

  it.each([
    ['source order', collidingSources],
    ['reverse source order', [...collidingSources].reverse()],
  ])('leaves every source sharing one best account unanswered in %s', (_label, sources) => {
    expect(inferAccountMappings(sources, {}, {
      rowAccounts: [everyday],
      counterpartyAccounts: [everyday],
    })).toEqual({})
  })

  it('treats distinct source IDs with the same label as a collision', () => {
    const sources = [
      createSource('first', { label: 'Everyday Chequing', matchText: 'Everyday Chequing' }),
      createSource('second', { label: 'Everyday Chequing', matchText: 'Everyday Chequing' }),
    ]

    expect(inferAccountMappings(sources, {}, {
      rowAccounts: [everyday],
      counterpartyAccounts: [everyday],
    })).toEqual({})
  })

  it('keeps an unanswered sibling unresolved after one collision member is answered', () => {
    const sources = collidingSources.slice(0, 2)

    expect(inferAccountMappings(sources, { 'everyday-source': 'everyday' }, {
      rowAccounts: [everyday],
      counterpartyAccounts: [everyday],
    })).toEqual({ 'everyday-source': 'everyday' })
  })

  it('matches three sources independently when all three exact accounts exist', () => {
    const accounts = [
      everyday,
      createAccount({ id: 'card-one', name: 'Everyday Chequing Card One' }),
      createAccount({ id: 'card-two', name: 'Everyday Chequing Card Two' }),
    ]

    expect(inferAccountMappings(collidingSources, {}, {
      rowAccounts: accounts,
      counterpartyAccounts: accounts,
    })).toEqual({
      'everyday-source': 'everyday',
      'card-one-source': 'card-one',
      'card-two-source': 'card-two',
    })
  })

  it('preserves a single source substring match', () => {
    const source = createSource('card-source', {
      label: 'Everyday Chequing Card',
      matchText: 'Everyday Chequing Card',
    })

    expect(inferAccountMappings([source], {}, {
      rowAccounts: [everyday],
      counterpartyAccounts: [everyday],
    })).toEqual({ 'card-source': 'everyday' })
  })

  it('preserves deliberate many-to-one answers', () => {
    const sources = collidingSources.slice(0, 2)
    const explicitMappings = {
      'everyday-source': 'everyday',
      'card-one-source': 'everyday',
    }

    expect(inferAccountMappings(sources, explicitMappings, {
      rowAccounts: [everyday],
      counterpartyAccounts: [everyday],
    })).toEqual(explicitMappings)
  })

  it('does not let a manual answer without a name candidate reserve an account', () => {
    const sources = [
      createSource('manual-source', { label: 'Unrelated', matchText: 'Unrelated' }),
      createSource('everyday-source', { label: 'Everyday Chequing', matchText: 'Everyday Chequing' }),
    ]

    expect(inferAccountMappings(sources, { 'manual-source': 'everyday' }, {
      rowAccounts: [everyday],
      counterpartyAccounts: [everyday],
    })).toEqual({
      'manual-source': 'everyday',
      'everyday-source': 'everyday',
    })
  })

  it('keeps row and counterparty sources on their separate eligible account lists', () => {
    const rowSource = createSource('row-source', {
      label: 'Everyday Chequing',
      matchText: 'Everyday Chequing',
    })
    const counterpartySource = createSource('counterparty-source', {
      label: 'Everyday Chequing',
      matchText: 'Everyday Chequing',
      isCounterpartyOnly: true,
    })
    const archivedExact = createAccount({ id: 'archived-everyday', name: 'Everyday Chequing', is_archived: true })

    expect(inferAccountMappings([rowSource, counterpartySource], {}, {
      rowAccounts: [everyday],
      counterpartyAccounts: [archivedExact],
    })).toEqual({
      'row-source': 'everyday',
      'counterparty-source': 'archived-everyday',
    })
  })
})
