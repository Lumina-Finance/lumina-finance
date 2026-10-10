/**
 * Tests what an import started from an account does to the mapping answers: every source rows are
 * written to takes that account, and counterparty sources are left alone
 */
import { describe, expect, it } from 'vitest'
import type { ImportAccountSource } from '@/pages/imports/types'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import { applyFixedImportAccount } from '@/pages/imports/utils'

/**
 * Creates a mapping source, defaulting to one rows are written to
 */
function createSource(id: string, overrides: Partial<ImportAccountSource> = {}): ImportAccountSource {
  return { id, label: id, matchText: id, isCounterpartyOnly: false, ...overrides }
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

  // Every source rows are written to rather than the first of them, so answering one and stopping
  // would leave the rest to the create-new fallback while the step says every row goes to one
  // account
  it('answers every source rows are written to', () => {
    const sources = [
      createSource('Everyday'),
      createSource('Travel Card'),
      COUNTERPARTY_SOURCE,
    ]

    expect(applyFixedImportAccount(sources, {}, 'acct-1')).toEqual({
      Everyday: 'acct-1',
      'Travel Card': 'acct-1',
    })
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
