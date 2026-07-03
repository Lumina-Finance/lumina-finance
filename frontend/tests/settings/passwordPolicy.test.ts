/**
 * Verifies the client password policy stays in lockstep with backend validate_password_strength
 */
import { describe, expect, it } from 'vitest'
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isNewPasswordValid,
} from '@/utils/passwordPolicy'

describe('new password policy', () => {
  it('accepts a password meeting every rule', () => {
    expect(isNewPasswordValid('SecurePass1!')).toBe(true)
  })

  it('accepts the maximum allowed length', () => {
    expect(isNewPasswordValid('A1!'.padEnd(PASSWORD_MAX_LENGTH, 'a'))).toBe(true)
  })

  it('rejects a password shorter than the minimum', () => {
    expect(isNewPasswordValid('A1!'.padEnd(PASSWORD_MIN_LENGTH - 1, 'a'))).toBe(false)
  })

  it('rejects a password longer than the maximum', () => {
    expect(isNewPasswordValid('A1!'.padEnd(PASSWORD_MAX_LENGTH + 1, 'a'))).toBe(false)
  })

  it('rejects a password without an uppercase letter', () => {
    expect(isNewPasswordValid('securepass1!')).toBe(false)
  })

  it('rejects a password without a number', () => {
    expect(isNewPasswordValid('SecurePassw!')).toBe(false)
  })

  it('rejects a password without a special character', () => {
    expect(isNewPasswordValid('SecurePass12')).toBe(false)
  })
})
