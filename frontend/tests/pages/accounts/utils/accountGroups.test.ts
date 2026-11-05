/**
 * Tests how the account list is split into groups under each grouping, so an account lands in the
 * group a user expects, with the right subtotal, accent and order, and the saved choice cannot bring
 * back a grouping the page no longer offers
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountType } from '@/api/accounts'
import { ACCOUNT_KIND_BY_TYPE } from '@/api/accounts'
import {
  ACCOUNT_GROUPING_KEY,
  ACCOUNT_KEEP_EXPANDED_KEY,
  ACCOUNT_SHOW_LOGOS_KEY,
  ACCOUNT_THEN_GROUPING_KEY,
  readStoredAccountGrouping,
  readStoredFlag,
  readStoredThenGrouping,
} from '@/pages/accounts/hooks/useAccountGrouping'
import {
  getAccountGroups,
  getAccountRowMeta,
  getGroupDots,
  getGroupingSummary,
  getGroupPlanNames,
  isGroupOpen,
} from '@/pages/accounts/utils/accountGroups'
import { createAccount, createInstitution, createTaxAdvantagedCategory } from './fixtures'

const alpha = createInstitution('a', 'Alpha Bank')
const zeta = createInstitution('z', 'Zeta Bank')

function createTypedAccount(id: string, account_type: AccountType, overrides = {}) {
  return createAccount({ id, account_type, account_kind: ACCOUNT_KIND_BY_TYPE[account_type], ...overrides })
}

describe('account groups', () => {
  it('sorts assets by largest balance and debt by largest amount owed within a group', () => {
    const rows = [
      createTypedAccount('small', 'checking', { current_balance: 10 }),
      createTypedAccount('big', 'checking', { current_balance: 900 }),
      createTypedAccount('card', 'credit_card', { current_balance: -50 }),
      createTypedAccount('big-card', 'credit_card', { current_balance: -500 }),
    ]
    const groups = getAccountGroups({ rows, filteredRows: rows, grouping: 'type' })

    expect(groups[0].rows.map((account) => account.id)).toEqual(['big', 'small'])
    expect(groups[1].rows.map((account) => account.id)).toEqual(['big-card', 'card'])
    expect(groups[1].subtotal).toBe(-550)
  })

  it('groups by institution with unlinked accounts last and a mixed group neutral', () => {
    const rows = [
      createTypedAccount('z-chq', 'checking', { institution: zeta, current_balance: 100 }),
      createTypedAccount('a-chq', 'checking', { institution: alpha, current_balance: 300 }),
      createTypedAccount('a-card', 'credit_card', { institution: alpha, current_balance: -120 }),
      createTypedAccount('wallet', 'cash', { current_balance: 40 }),
    ]
    const groups = getAccountGroups({ rows, filteredRows: rows, grouping: 'institution' })

    expect(groups.map((group) => group.title)).toEqual(['Alpha Bank', 'Zeta Bank', 'No institution'])
    expect(groups[0].accent).toBe('neutral')
    expect(groups[0].subtotal).toBe(180)
    expect(groups[0].rows.map((account) => account.id)).toEqual(['a-chq', 'a-card'])
    expect(groups[1].accent).toBe('positive')
    expect(groups[2].rows.map((account) => account.id)).toEqual(['wallet'])
  })

  it('lists only the account types present, in the filter order', () => {
    const rows = [
      createTypedAccount('mortgage', 'mortgage', { current_balance: -9_000 }),
      createTypedAccount('chq', 'checking'),
      createTypedAccount('card', 'credit_card'),
    ]
    const groups = getAccountGroups({ rows, filteredRows: rows, grouping: 'type' })

    expect(groups.map((group) => group.title)).toEqual(['Checking', 'Credit card', 'Mortgage'])
    expect(groups.map((group) => group.accent)).toEqual(['positive', 'negative', 'negative'])
  })

  it('keeps a group and its subtotal when the filters leave it no rows', () => {
    const rows = [
      createTypedAccount('chq', 'checking', { institution: alpha, current_balance: 100 }),
      createTypedAccount('sav', 'savings', { institution: zeta, current_balance: 250 }),
    ]
    const groups = getAccountGroups({ rows, filteredRows: [rows[0]], grouping: 'institution' })

    expect(groups.map((group) => group.title)).toEqual(['Alpha Bank', 'Zeta Bank'])
    expect(groups[1].rows).toEqual([])
    expect(groups[1].subtotal).toBe(250)
    expect(groups[1].emptyLabel).toBe('No matching accounts')
  })

  it('holds one placeholder group when there are no accounts to group', () => {
    const groups = getAccountGroups({ rows: [], filteredRows: [], grouping: 'institution' })

    expect(groups.map((group) => group.title)).toEqual(['Accounts'])
    expect(groups[0].emptyLabel).toBe('No accounts yet')
  })
})

describe('saved account grouping', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubStoredGrouping(value: string | null) {
    vi.stubGlobal('window', {
      localStorage: { getItem: (key: string) => (key === ACCOUNT_GROUPING_KEY ? value : null) },
    })
  }

  it('reads back a saved grouping', () => {
    stubStoredGrouping('institution')
    expect(readStoredAccountGrouping()).toBe('institution')
  })

  it('uses account type when nothing valid is saved, including a grouping that was removed', () => {
    stubStoredGrouping(null)
    expect(readStoredAccountGrouping()).toBe('type')

    stubStoredGrouping('by_colour')
    expect(readStoredAccountGrouping()).toBe('type')

    stubStoredGrouping('asset_class')
    expect(readStoredAccountGrouping()).toBe('type')

    stubStoredGrouping('kind')
    expect(readStoredAccountGrouping()).toBe('type')
  })
})

describe('second grouping level', () => {
  const rows = [
    createTypedAccount('a-chq', 'checking', { institution: alpha, current_balance: 300 }),
    createTypedAccount('a-sav', 'savings', { institution: alpha, current_balance: 100 }),
    createTypedAccount('z-sav', 'savings', { institution: zeta, current_balance: 500 }),
  ]

  it('splits each group by the second grouping and lists only the sub-groups that hold an account', () => {
    const groups = getAccountGroups({ rows, filteredRows: rows, grouping: 'institution', thenBy: 'type' })

    expect(groups.map((group) => group.title)).toEqual(['Alpha Bank', 'Zeta Bank'])
    expect(groups[0].children.map((child) => child.title)).toEqual(['Checking', 'Savings'])
    expect(groups[1].children.map((child) => child.title)).toEqual(['Savings'])
    // Each sub-group totals its own accounts and the group above totals them all
    expect(groups[0].children.map((child) => child.subtotal)).toEqual([300, 100])
    expect(groups[0].subtotal).toBe(400)
  })

  it('leaves the groups one level deep when the second grouping is none or repeats the first', () => {
    for (const thenBy of [null, 'type' as const]) {
      const groups = getAccountGroups({ rows, filteredRows: rows, grouping: 'type', thenBy })
      expect(groups.every((group) => group.children.length === 0)).toBe(true)
    }
  })

  it('keeps the sub-groups of a group whose rows the filters all remove', () => {
    const groups = getAccountGroups({ rows, filteredRows: [rows[2]], grouping: 'institution', thenBy: 'type' })

    expect(groups[0].children.map((child) => child.title)).toEqual(['Checking', 'Savings'])
    expect(groups[0].children.every((child) => child.rows.length === 0)).toBe(true)
    expect(groups[0].subtotal).toBe(400)
  })
})

describe('naming the grouping', () => {
  it('names one level, or both joined with then', () => {
    expect(getGroupingSummary('type', null)).toBe('Account type')
    expect(getGroupingSummary('institution', 'type')).toBe('Institution, then Account type')
    expect(getGroupingSummary('type', 'institution')).toBe('Account type, then Institution')
  })
})

describe('which groups are open', () => {
  const none: ReadonlySet<string> = new Set()
  const flipped: ReadonlySet<string> = new Set(['a', 'a/b'])

  it('opens only the top level when groups are kept expanded, and never a sub-group', () => {
    expect(isGroupOpen({ key: 'a', isTopLevel: true, keepExpanded: true, toggledKeys: none })).toBe(true)
    expect(isGroupOpen({ key: 'a/b', isTopLevel: false, keepExpanded: true, toggledKeys: none })).toBe(false)
  })

  it('closes every group when groups are not kept expanded', () => {
    expect(isGroupOpen({ key: 'a', isTopLevel: true, keepExpanded: false, toggledKeys: none })).toBe(false)
    expect(isGroupOpen({ key: 'a/b', isTopLevel: false, keepExpanded: false, toggledKeys: none })).toBe(false)
  })

  it('flips a group the user opened or closed by hand, with the switch on or off', () => {
    expect(isGroupOpen({ key: 'a', isTopLevel: true, keepExpanded: true, toggledKeys: flipped })).toBe(false)
    expect(isGroupOpen({ key: 'a/b', isTopLevel: false, keepExpanded: true, toggledKeys: flipped })).toBe(true)
    expect(isGroupOpen({ key: 'a', isTopLevel: true, keepExpanded: false, toggledKeys: flipped })).toBe(true)
    expect(isGroupOpen({ key: 'a/b', isTopLevel: false, keepExpanded: false, toggledKeys: flipped })).toBe(true)
    // Another group with the same name under a different parent is not the one flipped
    expect(isGroupOpen({ key: 'c/b', isTopLevel: false, keepExpanded: false, toggledKeys: flipped })).toBe(false)
  })
})

describe('an account row inside a group', () => {
  const account = createTypedAccount('a-chq', 'checking', { institution: alpha })
  const unfiled = createTypedAccount('wallet', 'cash')

  it('leaves out the type, the institution or both, whichever the groups above already say', () => {
    expect(getAccountRowMeta(account, ['type'])).toBe('Alpha Bank')
    expect(getAccountRowMeta(unfiled, ['type'])).toBe('No institution')
    expect(getAccountRowMeta(account, ['institution'])).toBe('Checking')
    expect(getAccountRowMeta(account, ['institution', 'type'])).toBe('')
    expect(getAccountRowMeta(account, ['type', 'institution'])).toBe('')
  })
})

describe('the tax-advantaged tags on a bank header', () => {
  const tfsa = createTaxAdvantagedCategory({ id: 'tfsa', name: 'TFSA' })
  const rrsp = createTaxAdvantagedCategory({ id: 'rrsp', name: 'RRSP' })
  const planById = new Map([tfsa, rrsp].map((plan) => [plan.id, plan]))

  function groupOf(members: ReturnType<typeof createTypedAccount>[]) {
    return getAccountGroups({ rows: members, filteredRows: members, grouping: 'institution' })[0]
  }

  it('names each category once, in the order the group lists its rows', () => {
    const group = groupOf([
      createTypedAccount('small', 'savings', {
        institution: alpha,
        current_balance: 10,
        tax_advantaged_category_id: 'tfsa',
      }),
      createTypedAccount('big', 'investment', {
        institution: alpha,
        current_balance: 900,
        tax_advantaged_category_id: 'rrsp',
      }),
      createTypedAccount('mid', 'investment', {
        institution: alpha,
        current_balance: 90,
        tax_advantaged_category_id: 'tfsa',
      }),
    ])

    expect(getGroupPlanNames(group, planById)).toEqual(['RRSP', 'TFSA'])
  })

  it('names nothing for accounts with no category, an unknown category or a group account', () => {
    const group = groupOf([
      createTypedAccount('plain', 'savings', { institution: alpha }),
      createTypedAccount('unknown', 'savings', { institution: alpha, tax_advantaged_category_id: 'gone' }),
      createTypedAccount('shared', 'savings', {
        institution: alpha,
        group_id: 'g',
        tax_advantaged_category_id: 'tfsa',
      }),
    ])

    expect(getGroupPlanNames(group, planById)).toEqual([])
  })
})

describe('the dots under a bank header', () => {
  it('gives one dot per account, red for a negative balance, and stops at five', () => {
    const members = Array.from({ length: 7 }, (_, index) =>
      createTypedAccount(`acct-${index}`, 'checking', { current_balance: index === 1 ? -5 : 5 }),
    )
    const dots = getGroupDots(members)

    expect(dots.map((dot) => dot.id)).toEqual(['acct-0', 'acct-1', 'acct-2', 'acct-3', 'acct-4'])
    expect(dots.map((dot) => dot.isNegative)).toEqual([false, true, false, false, false])
  })
})

describe('saved grouping settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubStorage(values: Record<string, string>) {
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values[key] ?? null } })
  }

  it('reads back a saved second level and drops one that is gone or repeats the first', () => {
    stubStorage({ [ACCOUNT_GROUPING_KEY]: 'type', [ACCOUNT_THEN_GROUPING_KEY]: 'institution' })
    expect(readStoredThenGrouping()).toBe('institution')

    stubStorage({ [ACCOUNT_GROUPING_KEY]: 'type', [ACCOUNT_THEN_GROUPING_KEY]: 'type' })
    expect(readStoredThenGrouping()).toBeNull()

    stubStorage({ [ACCOUNT_GROUPING_KEY]: 'type', [ACCOUNT_THEN_GROUPING_KEY]: 'asset_class' })
    expect(readStoredThenGrouping()).toBeNull()

    stubStorage({ [ACCOUNT_GROUPING_KEY]: 'type', [ACCOUNT_THEN_GROUPING_KEY]: 'none' })
    expect(readStoredThenGrouping()).toBeNull()

    stubStorage({})
    expect(readStoredThenGrouping()).toBeNull()
  })

  it('reads a switch as saved and takes its default when nothing is saved', () => {
    stubStorage({ [ACCOUNT_SHOW_LOGOS_KEY]: 'off', [ACCOUNT_KEEP_EXPANDED_KEY]: 'on' })
    expect(readStoredFlag(ACCOUNT_SHOW_LOGOS_KEY, true)).toBe(false)
    expect(readStoredFlag(ACCOUNT_KEEP_EXPANDED_KEY, false)).toBe(true)

    stubStorage({})
    expect(readStoredFlag(ACCOUNT_SHOW_LOGOS_KEY, true)).toBe(true)
    expect(readStoredFlag(ACCOUNT_KEEP_EXPANDED_KEY, true)).toBe(true)

    // A value that is neither word is not a choice, so the switch takes its default
    stubStorage({ [ACCOUNT_SHOW_LOGOS_KEY]: 'maybe', [ACCOUNT_KEEP_EXPANDED_KEY]: 'maybe' })
    expect(readStoredFlag(ACCOUNT_SHOW_LOGOS_KEY, true)).toBe(true)
    expect(readStoredFlag(ACCOUNT_KEEP_EXPANDED_KEY, false)).toBe(false)
  })
})
