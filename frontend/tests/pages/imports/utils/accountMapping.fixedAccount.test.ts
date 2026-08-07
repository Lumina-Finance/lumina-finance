/**
 * Tests what an import started from an account does to the mapping answers: every source rows are
 * written to takes that account, and the two things layered after it, the name match and the
 * create-new fallback, both find nothing left to answer
 */
import { describe, expect, it } from 'vitest'
import { CREATE_ACCOUNT_VALUE } from '@/pages/imports/constants'
import type { AccountsOverview } from '@/api/accounts'
import type { ImportAccountSource } from '@/pages/imports/types'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import {
  applyCreateAccountFallback,
  applyFixedImportAccount,
  inferAccountMappings,
} from '@/pages/imports/utils'

/**
 * Creates a mapping source, defaulting to one rows are written to
 */
function createSource(id: string, overrides: Partial<ImportAccountSource> = {}): ImportAccountSource {
  return { id, label: id, matchText: id, isCounterpartyOnly: false, ...overrides }
}

/**
 * Creates an account overview, carrying only the fields these rules read
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
    is_archived: false,
    closed_at: null,
    ...overrides,
  }
}

// With no account column mapped the file itself is the one source rows are written to, which is
// what a scoped import always has
const FILE_SOURCE = createSource('file-1')
const COUNTERPARTY_SOURCE = createSource('Mum', { isCounterpartyOnly: true })

describe('filing every row into the account an import was started from', () => {
  it('answers the file source and leaves a counterparty source alone', () => {
    const sources = [FILE_SOURCE, COUNTERPARTY_SOURCE]

    expect(applyFixedImportAccount(sources, {}, 'acct-1')).toEqual({ 'file-1': 'acct-1' })
  })

  // The step shows no dropdown to answer a row source with while the account is fixed, so an answer
  // stored under an earlier scope cannot be corrected by hand and has to give way here
  it('overrides an answer stored for that source', () => {
    expect(applyFixedImportAccount([FILE_SOURCE], { 'file-1': 'acct-9' }, 'acct-1')).toEqual({
      'file-1': 'acct-1',
    })
  })

  it('leaves a counterparty answer alone', () => {
    expect(applyFixedImportAccount([COUNTERPARTY_SOURCE], { Mum: OUTSIDE_ACCOUNT_VALUE }, 'acct-1')).toEqual({
      Mum: OUTSIDE_ACCOUNT_VALUE,
    })
  })

  // Which is what the page holds the moment the user follows the link out of the scope
  it('changes nothing at all for an ordinary import', () => {
    expect(applyFixedImportAccount([FILE_SOURCE], { 'file-1': 'acct-9' }, null)).toEqual({
      'file-1': 'acct-9',
    })
  })
})

describe('what the layers after it do with an answered source', () => {
  const accounts = [createAccount()]

  // The file is called Everyday.csv, which the match would otherwise read as the account of that
  // name, so this is the case where the two disagree
  const namedLikeAnAccount = createSource('file-1', { label: 'Everyday', matchText: 'Everyday.csv' })

  it('leaves the name match nothing to change', () => {
    const answered = applyFixedImportAccount([namedLikeAnAccount], {}, 'acct-2')

    expect(inferAccountMappings([namedLikeAnAccount], answered, {
      rowAccounts: accounts,
      counterpartyAccounts: accounts,
    })).toEqual({ 'file-1': 'acct-2' })
  })

  it('leaves the create-new fallback nothing to rest on create', () => {
    const answered = applyFixedImportAccount([FILE_SOURCE], {}, 'acct-1')

    expect(applyCreateAccountFallback([FILE_SOURCE], answered)).toEqual({ 'file-1': 'acct-1' })
    expect(applyCreateAccountFallback([FILE_SOURCE], {})).toEqual({ 'file-1': CREATE_ACCOUNT_VALUE })
  })
})
