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
  getAuthSubmitBlockReason,
  getCurrencyPlaceholder,
  getLockoutExpiry,
  getLockoutRemainingLabel,
  getRefusedAuthFields,
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
      { value: 'CAD', label: 'CAD: Canadian Dollar ($)' },
      { value: 'USD', label: 'USD: US Dollar (US$)' },
    ])
    expect(getCurrencyPlaceholder(false, 0)).toBe('Loading currencies…')
    expect(getCurrencyPlaceholder(true, 0)).toBe('Failed to load currencies')
    expect(isAuthSubmitDisabled(false, {}, 'signup', 0)).toBe(true)
    expect(isAuthSubmitDisabled(false, {}, 'login', 0)).toBe(false)
    expect(getAuthSubmitBlockReason(false, {}, 'signup', 0)).toBe('Currencies are not available yet')
    expect(getAuthSubmitBlockReason(false, {}, 'login', 0)).toBeUndefined()
  })

  it('gives the submit button a reason only when the form holds it off, not its own request', () => {
    expect(getAuthSubmitBlockReason(false, { email: 'Enter a valid email' }, 'login', 2)).toBe('Fix the fields with errors first')
    expect(getAuthSubmitBlockReason(true, { email: 'Enter a valid email' }, 'login', 2)).toBeUndefined()
  })

  it('maps backend errors and lockout timestamps into user-facing auth state', () => {
    const lockoutError = new ApiError('Account temporarily locked', 423)
    const genericError = new ApiError('Unexpected backend detail', 500)

    expect(isAuthLockoutError(lockoutError)).toBe(true)
    expect(isAuthLockoutError(genericError)).toBe(false)
    expect(getAuthErrorMessage(new ApiError('Invalid credentials', 401))).toBe('Incorrect email or password. Please try again.')
    expect(getAuthErrorMessage(genericError)).toBe('Something went wrong. Please try again.')

    // A sign-up form left open after registration closed must say so rather than invite a retry
    expect(getAuthErrorMessage(new ApiError('Registration is closed on this instance', 403))).toBe(
      'Registration is closed on this instance.',
    )
    expect(getLockoutExpiry(1000)).toBe(1831000)
    expect(getLockoutRemainingLabel('1831000', 1000)).toBe('30:30')
    expect(getLockoutRemainingLabel('999', 1000)).toBeNull()
  })

  it("puts each field a validation refusal named on that field, in the form's words where it has them", () => {
    const refusal = new ApiError("Oops, the email, first name and tz weren't accepted. Please check them and try again.", 422, {
      fieldErrors: [
        { field: 'email', message: 'value is not a valid email address' },
        { field: 'first_name', message: 'String should have at most 100 characters' },
        { field: 'tz', message: 'Invalid timezone' },
      ],
    })

    expect(getRefusedAuthFields(refusal)).toEqual({
      email: 'Enter a valid email address',
      first_name: 'String should have at most 100 characters',
    })
    expect(getRefusedAuthFields(new ApiError('Invalid credentials', 401))).toEqual({})
  })

  it('names the refused fields in the banner of a form that has none of them', () => {
    const message = "Oops, the token wasn't accepted. Please check it and try again."
    const refusal = new ApiError(message, 422, {
      fieldErrors: [{ field: 'token', message: 'Field required' }],
    })

    expect(getAuthErrorMessage(refusal)).toBe(message)
  })
})
