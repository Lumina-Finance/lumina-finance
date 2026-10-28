/**
 * Tests auth form policy helpers so refactors catch broken login validation, signup payloads, lockout timers, and currency-loading guards before the page submits
 */
import { describe, expect, it } from 'vitest'
import { ApiError, buildApiError } from '@/api/auth'
import type { Currency } from '@/api/currency'
import {
  buildCurrencyOptions,
  buildInitialAuthForm,
  buildLoginPayload,
  buildSignupPayload,
  emailFromConfirmationToken,
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
    }, 'signup')).toEqual({
      email: 'Enter a valid email address',
      first_name: 'First name is required',
    })

    // Sign-up asks for no password, since it is chosen on the emailed link's page
    expect(validateAuthFields({
      ...buildInitialAuthForm('America/Toronto'),
      email: 'user@example.com',
      first_name: 'Dana',
    }, 'signup')).toEqual({})
    expect(isAuthFieldErrorKey('email')).toBe(true)
    expect(isAuthFieldErrorKey('last_name')).toBe(false)
  })

  it('builds touched fields and backend payloads without leaking view-only fields', () => {
    const form = {
      ...buildInitialAuthForm('America/Toronto'),
      email: 'user@example.com',
      password: 'StrongPassword1!',
      first_name: ' Dana ',
      last_name: ' ',
      base_currency: 'USD',
    }

    expect(getSubmitTouchedFields('signup')).toEqual({ email: true, first_name: true })
    expect(buildLoginPayload(form)).toEqual({
      email: 'user@example.com',
      password: 'StrongPassword1!',
    })
    expect(buildSignupPayload(form)).toEqual({
      email: 'user@example.com',
      first_name: 'Dana',
      last_name: undefined,
      tz: 'America/Toronto',
      base_currency: 'USD',
    })
  })

  it('guards signup when currencies are loading or failed', () => {
    expect(buildCurrencyOptions(currencies)).toEqual([
      { value: 'CAD', label: 'CAD · Canadian Dollar (CA$)' },
      { value: 'USD', label: 'USD · US Dollar ($)' },
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

  // A timed-out or unexplained failure used to show one sentence that hid what happened
  it('says the server took too long, or could not be reached, in its own words', () => {
    const timeout = new DOMException('Oops, the server took too long to answer. Please try again.', 'TimeoutError')
    expect(getAuthErrorMessage(timeout)).toBe('Oops, the server took too long to answer. Please try again.')

    // The browser's own words for a dropped connection, such as "Failed to fetch", are not for the screen
    expect(getAuthErrorMessage(new TypeError('Failed to fetch'))).toBe("Couldn't reach the server. Please try again.")
  })

  // These pages face anyone, so a server's detail, a status or a field name could help someone probing them
  it('shows only the friendly sentence for a refusal the form has no words for', () => {
    const generic = 'Oops, something went wrong. Please try again.'
    expect(getAuthErrorMessage(buildApiError(500, { detail: 'IntegrityError on users.email_key' }))).toBe(generic)
    expect(getAuthErrorMessage(buildApiError(500, null))).toBe(generic)
    expect(getAuthErrorMessage(buildApiError(429, { detail: 'Rate limit 5/minute exceeded' }))).toBe(generic)
    const refusal = new ApiError("Oops, the token wasn't accepted. Please check it and try again.", 422, {
      fieldErrors: [{ field: 'token', message: 'Field required' }],
    })
    expect(getAuthErrorMessage(refusal)).toBe(generic)
  })
})

describe('emailFromConfirmationToken', () => {
  const encode = (payload: object) => btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  it('reads the email from the token payload', () => {
    expect(emailFromConfirmationToken(`header.${encode({ email: 'ada@example.com' })}.signature`)).toBe('ada@example.com')
  })

  it('reads an address with non-ASCII characters', () => {
    const utf8 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ email: 'zoë@example.com' }))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    expect(emailFromConfirmationToken(`header.${utf8}.signature`)).toBe('zoë@example.com')
  })

  it('returns an empty string for a token it cannot read', () => {
    expect(emailFromConfirmationToken('not-a-token')).toBe('')
    expect(emailFromConfirmationToken(`header.${encode({ sub: 'x' })}.signature`)).toBe('')
  })
})
