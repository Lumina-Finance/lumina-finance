import { ApiError, NO_EXPLANATION_MESSAGE, type LoginPayload, type SignupPayload } from '@/api/auth'
import type { Currency } from '@/api/currency'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import { formatCurrencyLabel } from '@/utils/formatCurrency'
import { SERVER_UNREACHABLE_MESSAGE } from '@/api/server'

export type AuthMode = 'login' | 'signup' | 'forgot'

export interface AuthFormValues {
  email: string
  password: string
  first_name: string
  last_name: string
  base_currency: string
  tz: string
}

export interface AuthFieldErrors {
  email?: string
  password?: string
  first_name?: string
}

const AUTH_FIELD_ERROR_KEYS: ReadonlySet<keyof AuthFormValues> = new Set(['email', 'password', 'first_name'])

export const LOCKOUT_KEY = 'lumina:auth_lockout'
export const LOCKOUT_MS = 30 * 60 * 1000 + 30 * 1000
export const FADE_OUT_MS = 300

/**
 * Reads the email a sign-up confirmation token was issued for, only to show it on the confirm page
 *
 * The payload is read without checking the signature, which the server does when the link is used
 */
export function emailFromConfirmationToken(token: string): string {
  try {
    const payload = token.split('.')[1] ?? ''
    const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const json = new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
    const email = (JSON.parse(json) as { email?: unknown }).email
    return typeof email === 'string' ? email : ''
  } catch {
    return ''
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// The form's own wording for a field the server's validation refused, keyed by the request field.
// A field without one shows the server's reason
const FIELD_REFUSAL_MESSAGES: Partial<Record<keyof AuthFieldErrors, string>> = {
  email: 'Enter a valid email address',
  password: 'Password does not meet requirements',
}

// Shown by a sign-up form submitted after registration closed, and on the login page when a provider
// sign-in is refused for the same reason
export const REGISTRATION_CLOSED_NOTICE = 'Registration is closed on this instance.'

const ERROR_MESSAGES: Record<string, string> = {
  'Invalid credentials': 'Incorrect email or password. Please try again.',
  'Account temporarily locked': 'Too many failed attempts.',
  'Invalid currency code': 'The selected currency is not supported.',
  'Invalid code': 'That code was incorrect. Please try again.',
  'Invalid or expired challenge': 'Your verification expired. Please log in again.',
  'Registration is closed on this instance': REGISTRATION_CLOSED_NOTICE,
}

/**
 * Determines the auth mode from the current route path so route changes stay decoupled from form state
 */
export function getAuthMode(pathname: string): AuthMode {
  if (pathname === '/signup') return 'signup'
  if (pathname === '/forgot-password') return 'forgot'
  return 'login'
}

/**
 * Builds the initial auth form with detected browser defaults supplied by the page shell
 */
export function buildInitialAuthForm(timezone: string, baseCurrency = 'CAD'): AuthFormValues {
  return {
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    base_currency: baseCurrency,
    tz: timezone,
  }
}

/**
 * Validates fields that block login or signup before a backend request is sent
 */
export function validateAuthFields(form: AuthFormValues, mode: AuthMode): AuthFieldErrors {
  const errors: AuthFieldErrors = {}

  if (!form.email) {
    errors.email = 'Email is required'
  } else if (!EMAIL_RE.test(form.email)) {
    errors.email = 'Enter a valid email address'
  }

  // Forgot-password only asks for an email, so the password rules never apply
  if (mode === 'forgot') return errors

  // Sign-up asks for no password, since the person chooses it when they open the emailed link
  if (mode === 'signup') {
    if (!form.first_name.trim()) {
      errors.first_name = 'First name is required'
    }
    return errors
  }

  if (!form.password) {
    errors.password = 'Password is required'
  }

  return errors
}

/**
 * Narrows editable form fields to fields that can show validation errors
 */
export function isAuthFieldErrorKey(field: keyof AuthFormValues): field is keyof AuthFieldErrors {
  return AUTH_FIELD_ERROR_KEYS.has(field)
}

/**
 * Marks every required field as touched after submit so validation errors become visible together
 */
export function getSubmitTouchedFields(mode: AuthMode): Record<string, boolean> {
  if (mode === 'forgot') return { email: true }

  if (mode === 'signup') return { email: true, first_name: true }
  return { email: true, password: true }
}

/**
 * Builds a login payload from the fields the backend accepts
 */
export function buildLoginPayload(form: AuthFormValues): LoginPayload {
  return {
    email: form.email,
    password: form.password,
  }
}

/**
 * Builds a signup payload while trimming names and omitting an empty optional last name
 */
export function buildSignupPayload(form: AuthFormValues): SignupPayload {
  return {
    email: form.email,
    first_name: form.first_name.trim(),
    last_name: form.last_name.trim() || undefined,
    tz: form.tz,
    base_currency: form.base_currency,
  }
}

/**
 * Converts loaded currencies into dropdown options without exposing API objects to the form view
 */
export function buildCurrencyOptions(currencies: Currency[]): DropdownOption[] {
  return currencies.map((currency) => ({
    value: currency.id,
    label: formatCurrencyLabel(currency),
  }))
}

/**
 * Describes the currency picker state when signup depends on reference data from the backend
 */
export function getCurrencyPlaceholder(currenciesError: boolean, currencyCount: number): string {
  if (currenciesError) return 'Failed to load currencies'
  if (currencyCount === 0) return 'Loading currencies…'
  return 'Select...'
}

/**
 * Prevents submit when the form is busy, invalid, or signup cannot load required currency options
 */
export function isAuthSubmitDisabled(
  submitting: boolean,
  fieldErrors: AuthFieldErrors,
  mode: AuthMode,
  currencyCount: number,
): boolean {
  return submitting || Object.values(fieldErrors).some(Boolean) || (mode === 'signup' && currencyCount === 0)
}

/**
 * Says why the submit button is held off when the form itself is the cause, or nothing while it is
 * ready or only waiting on its own request
 */
export function getAuthSubmitBlockReason(
  submitting: boolean,
  fieldErrors: AuthFieldErrors,
  mode: AuthMode,
  currencyCount: number,
): string | undefined {
  if (submitting) return undefined
  if (Object.values(fieldErrors).some(Boolean)) return 'Fix the fields with errors first'
  if (mode === 'signup' && currencyCount === 0) return 'Currencies are not available yet'
  return undefined
}

/**
 * Puts a failed auth request in the form's words where it has them, and otherwise in one of the request
 * layer's own safe sentences: the timeout's, the dropped connection's, or the friendly sentence
 *
 * The server's own explanation is never shown as it stands, since these pages face anyone, and a detail,
 * status or internal name there could tell someone probing them more than the form means to
 */
export function getAuthErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return error.message
  // The browser fails a request that never reached the server this way, with a message not written for
  // the screen
  if (error instanceof TypeError) return SERVER_UNREACHABLE_MESSAGE
  if (!(error instanceof ApiError)) return NO_EXPLANATION_MESSAGE
  return ERROR_MESSAGES[error.message] ?? NO_EXPLANATION_MESSAGE
}

/**
 * Identifies backend lockout errors so the browser can mirror the lockout timer before the next request
 */
export function isAuthLockoutError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 423
}

/**
 * Formats a stored lockout timestamp as minutes and seconds remaining
 */
export function getLockoutRemainingLabel(storedLockoutUntil: string | null, nowMs: number): string | null {
  if (!storedLockoutUntil) return null

  const lockoutUntil = Number(storedLockoutUntil)
  if (!Number.isFinite(lockoutUntil)) return null

  const diff = lockoutUntil - nowMs
  if (diff <= 0) return null

  const mins = Math.floor(diff / 60000)
  const secs = Math.floor((diff % 60000) / 1000)
  return `${mins}:${String(secs).padStart(2, '0')}`
}

/**
 * Calculates the local timestamp that mirrors the backend failed-login lockout duration
 */
export function getLockoutExpiry(nowMs: number): number {
  return nowMs + LOCKOUT_MS
}

/**
 * Reads the form fields a validation refusal named, in the form's own words where it has them, so
 * each lands on its field rather than in the banner, such as an address on a domain the server does
 * not accept
 */
export function getRefusedAuthFields(error: unknown): AuthFieldErrors {
  const refused: AuthFieldErrors = {}
  if (!(error instanceof ApiError)) return refused
  for (const { field, message } of error.fieldErrors ?? []) {
    if (!isAuthFieldErrorKey(field as keyof AuthFormValues)) continue
    const key = field as keyof AuthFieldErrors
    refused[key] ??= FIELD_REFUSAL_MESSAGES[key] ?? message
  }
  return refused
}
