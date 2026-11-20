/**
 * Guards when signing out of other devices is offered. An account with no password and no linked
 * provider has no way to confirm it is them, so the button is held off with a reason
 */
import { describe, expect, it } from 'vitest'
import { getEndOtherSessionsBlockedReason } from '@/pages/settings/utils/endOtherSessions'

describe('getEndOtherSessionsBlockedReason', () => {
  it('holds a passkey-only account off, giving a reason', () => {
    expect(getEndOtherSessionsBlockedReason(false, 0)).toEqual(expect.any(String))
    expect(getEndOtherSessionsBlockedReason(false, 0)).not.toBe('')
  })

  it('lets an account with a password go ahead, linked provider or not', () => {
    expect(getEndOtherSessionsBlockedReason(true, 0)).toBeUndefined()
    expect(getEndOtherSessionsBlockedReason(true, 2)).toBeUndefined()
  })

  it('lets a passwordless account with a linked provider go ahead', () => {
    expect(getEndOtherSessionsBlockedReason(false, 1)).toBeUndefined()
  })
})
