/**
 * Tests when Add transaction is held off on the list of every account because the create form would
 * have no account to offer
 */
import { describe, expect, it } from 'vitest'
import { getCreateBlockReason } from '@/components/transactions/utils/createBlockReason'

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
})
