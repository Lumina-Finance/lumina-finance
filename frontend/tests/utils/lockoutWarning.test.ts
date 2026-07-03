/**
 * Verifies the step-up lockout warning reads the attempts-remaining signal and counts down correctly
 */
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/auth'
import { buildLockoutWarning, getAttemptsRemaining } from '@/utils/lockoutWarning'

describe('getAttemptsRemaining', () => {
  it('returns the count from a step-up error that carries it', () => {
    expect(getAttemptsRemaining(new ApiError('Invalid credentials', 401, 3))).toBe(3)
  })

  it('returns zero when the failure just tripped the lock', () => {
    expect(getAttemptsRemaining(new ApiError('Invalid credentials', 401, 0))).toBe(0)
  })

  it('returns null for an error without the attempts signal', () => {
    expect(getAttemptsRemaining(new ApiError('Invalid credentials', 401))).toBeNull()
  })

  it('returns null for a non-api error', () => {
    expect(getAttemptsRemaining(new Error('boom'))).toBeNull()
  })
})

describe('buildLockoutWarning', () => {
  it('counts down while tries remain', () => {
    expect(buildLockoutWarning(3)).toBe(
      "3 attempts remaining before your account is locked and you're signed out everywhere.",
    )
  })

  it('uses the singular for the last try', () => {
    expect(buildLockoutWarning(1)).toBe(
      "1 attempt remaining before your account is locked and you're signed out everywhere.",
    )
  })

  it('reports the outcome once the lock has tripped', () => {
    expect(buildLockoutWarning(0)).toBe("Your account is now locked and you've been signed out everywhere.")
  })
})
