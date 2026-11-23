/**
 * Tests when Add transaction is held off on the list of every account because the create form would
 * have no account to offer, and why one account takes no new or changed transaction
 */
import { describe, expect, it } from 'vitest'
import { getAccountWriteBlockReason, getCreateBlockReason } from '@/components/transactions/utils/createBlockReason'

const READ_ONLY = 'Records in other currencies are read-only. They can be archived or deleted'

describe('why Add transaction is unavailable on the list of every account', () => {
  it('gives no reason while the accounts are loading', () => {
    expect(getCreateBlockReason(undefined)).toBeUndefined()
  })

  it('explains that every account is archived', () => {
    expect(getCreateBlockReason([{ is_archived: true }, { is_archived: true }])).toBe(
      'All your accounts are archived: unarchive one or create an account first',
    )
  })

  it('asks for an account when there are none', () => {
    expect(getCreateBlockReason([])).toBe('Create an account first')
  })

  it('gives no reason while one account is unarchived', () => {
    expect(getCreateBlockReason([{ is_archived: true }, { is_archived: false }])).toBeUndefined()
    expect(getCreateBlockReason([{}])).toBeUndefined()
  })

  // The form offers no read-only account, so these would leave it with none to offer
  it('gives the read-only sentence when every unarchived account is kept read-only', () => {
    expect(getCreateBlockReason([{ is_archived: true }, { is_archived: false, read_only_reason: READ_ONLY }])).toBe(
      READ_ONLY,
    )
  })

  it('gives no reason while one unarchived account takes writes beside a read-only one', () => {
    expect(getCreateBlockReason([{ read_only_reason: READ_ONLY }, { read_only_reason: null }])).toBeUndefined()
  })
})

// Read by the account page's Add transaction, the transaction form and the Transactions page, so a
// read-only account's transaction opens read-only wherever it is opened from
describe('why an account takes no new or changed transaction', () => {
  it('says an archived account is read-only, before any other reason', () => {
    expect(getAccountWriteBlockReason({ is_archived: true, read_only_reason: READ_ONLY })).toBe(
      'Archived accounts are read-only',
    )
  })

  it('gives the sentence an account in another currency is read-only for', () => {
    expect(getAccountWriteBlockReason({ is_archived: false, read_only_reason: READ_ONLY })).toBe(READ_ONLY)
  })

  it('says nothing about an account that takes writes, or none at all', () => {
    expect(getAccountWriteBlockReason({ is_archived: false, read_only_reason: null })).toBeUndefined()
    expect(getAccountWriteBlockReason({})).toBeUndefined()
    expect(getAccountWriteBlockReason(undefined)).toBeUndefined()
  })
})
