/**
 * Tests which accounts an import may be written to and why one is refused, which the transaction
 * list's import button and the import page both read, so neither offers an import the API refuses
 */
import { describe, expect, it } from 'vitest'
import { getImportBlockReason, isImportableAccount } from '@/utils/importableAccount'

const WRITABLE_ACCOUNT = { can_write: true, is_archived: false }

// Read both by the control offering the import and by the page carrying it out, so a state one of
// them accepts and the other refuses cannot exist
describe('which accounts an import may be written to', () => {
  it('accepts an unarchived account the user can write to', () => {
    expect(isImportableAccount(WRITABLE_ACCOUNT)).toBe(true)
  })

  it('refuses an archived account', () => {
    expect(isImportableAccount({ ...WRITABLE_ACCOUNT, is_archived: true })).toBe(false)
  })

  // The API writes rows only where the user can write, so a group account shared at read level is
  // refused before the file is staged rather than by the commit after every answer is given
  it('refuses an account the user can only read', () => {
    expect(isImportableAccount({ ...WRITABLE_ACCOUNT, can_write: false })).toBe(false)
  })

  it('refuses an account that is not there at all', () => {
    expect(isImportableAccount(undefined)).toBe(false)
    expect(isImportableAccount(null)).toBe(false)
  })

  // The transaction list is handed a summary of an account rather than the whole thing, so the rule
  // has to answer for one without an archived flag, the way the Add Transaction button
  // beside it already reads a missing archived flag
  it('takes a summary without an archived flag as not archived', () => {
    expect(isImportableAccount({ can_write: true })).toBe(true)
    expect(isImportableAccount({ can_write: false })).toBe(false)
  })
})

describe('why an import cannot be written to an account', () => {
  it('says nothing about an account an import can write to', () => {
    expect(getImportBlockReason(WRITABLE_ACCOUNT)).toBeUndefined()
  })

  it('says nothing where there is no account to speak of', () => {
    expect(getImportBlockReason(undefined)).toBeUndefined()
  })

  it('says an archived account is read-only', () => {
    expect(getImportBlockReason({ ...WRITABLE_ACCOUNT, is_archived: true })).toBe('Archived accounts are read-only')
  })

  // The same words the transaction rows use for an account the user can only read
  it('says an account the user can only read has read-only access', () => {
    expect(getImportBlockReason({ ...WRITABLE_ACCOUNT, can_write: false })).toBe('Read-only access')
  })

  it('names archiving first on an archived account the user can only read', () => {
    expect(getImportBlockReason({ can_write: false, is_archived: true })).toBe('Archived accounts are read-only')
  })
})
