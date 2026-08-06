/**
 * Tests auth form policy helpers so refactors catch broken login validation, signup payloads, lockout timers, and currency-loading guards before the page submits
 */
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/auth'
import type { Currency } from '@/api/currency'
import {
  buildCurrencyOptions,
  buildInitialAuthForm,
  buildLoginPayload,
  buildSignupPayload,
  getAuthErrorMessage,
  getAuthMode,
  getCurrencyPlaceholder,
  getDisplayAuthError,
  getLockoutExpiry,
  getLockoutRemainingLabel,
  getSubmitTouchedFields,
  isAuthFieldErrorKey,
  isAuthLockoutError,
  isAuthSubmitDisabled,
  validateAuthFields,
} from '@/pages/auth/utils/authForm'

const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'USD', name: 'US Dollar', symbol: 'US$', minor_unit_exponent: 2 },
]

describe('auth form helpers', () => {
  it('detects mode and builds initial form defaults from the page environment', () => {
    expect(getAuthMode('/signup')).toBe('signup')
    expect(getAuthMode('/login')).toBe('login')
    expect(buildInitialAuthForm('America/Toronto')).toMatchObject({
      base_currency: 'CAD',
      tz: 'America/Toronto',
    })
  })

  it('validates login and signup fields before backend requests are made', () => {
    expect(validateAuthFields(buildInitialAuthForm('America/Toronto'), 'login')).toEqual({
      email: 'Email is required',
      password: 'Password is required',
    })

    expect(validateAuthFields({
      ...buildInitialAuthForm('America/Toronto'),
      email: 'bad-email',
      password: 'weak',
    }, 'signup')).toEqual({
      email: 'Enter a valid email address',
      password: 'Password does not meet requirements',
      first_name: 'First name is required',
      confirm_password: 'Please confirm your password',
    })
    expect(isAuthFieldErrorKey('email')).toBe(true)
    expect(isAuthFieldErrorKey('last_name')).toBe(false)
  })

  it('builds touched fields and backend payloads without leaking view-only fields', () => {
    const form = {
      ...buildInitialAuthForm('America/Toronto'),
      email: 'user@example.com',
      password: 'StrongPassword1!',
      confirm_password: 'StrongPassword1!',
      first_name: ' Dana ',
      last_name: ' ',
      base_currency: 'USD',
    }

    expect(getSubmitTouchedFields('signup')).toEqual({
      email: true,
      password: true,
      first_name: true,
      confirm_password: true,
    })
    expect(buildLoginPayload(form)).toEqual({
      email: 'user@example.com',
      password: 'StrongPassword1!',
    })
    expect(buildSignupPayload(form)).toEqual({
      email: 'user@example.com',
      password: 'StrongPassword1!',
      first_name: 'Dana',
      last_name: undefined,
      tz: 'America/Toronto',
      base_currency: 'USD',
    })
  })

  it('guards signup when currencies are loading or failed', () => {
    expect(buildCurrencyOptions(currencies)).toEqual([
      { value: 'CAD', label: 'CAD — Canadian Dollar ($)' },
      { value: 'USD', label: 'USD — US Dollar (US$)' },
    ])
    expect(getCurrencyPlaceholder(false, 0)).toBe('Loading currencies…')
    expect(getCurrencyPlaceholder(true, 0)).toBe('Failed to load currencies')
    expect(getDisplayAuthError('', 'signup', true, 0)).toBe('Unable to load currencies. Please refresh and try again.')
    expect(isAuthSubmitDisabled(false, {}, 'signup', 0)).toBe(true)
    expect(isAuthSubmitDisabled(false, {}, 'login', 0)).toBe(false)
  })

  it('maps backend errors and lockout timestamps into user-facing auth state', () => {
    const lockoutError = new ApiError('Account temporarily locked', 423)
    const genericError = new ApiError('Unexpected backend detail', 500)

    expect(isAuthLockoutError(lockoutError)).toBe(true)
    expect(isAuthLockoutError(genericError)).toBe(false)
    expect(getAuthErrorMessage(new ApiError('Invalid credentials', 401))).toBe('Incorrect email or password. Please try again.')
    expect(getAuthErrorMessage(genericError)).toBe('Something went wrong. Please try again.')
    expect(getLockoutExpiry(1000)).toBe(1831000)
    expect(getLockoutRemainingLabel('1831000', 1000)).toBe('30:30')
    expect(getLockoutRemainingLabel('999', 1000)).toBeNull()
  })
})
