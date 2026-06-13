import { ApiError, type LoginPayload, type SignupPayload } from '@/api/auth'
import type { Currency } from '@/api/currency'
import type { DropdownOption } from '@/components/Dropdown'

export type AuthMode = 'login' | 'signup'

export interface AuthFormValues {
  email: string
  password: string
  confirm_password: string
  first_name: string
  last_name: string
  base_currency: string
  tz: string
}

export interface AuthFieldErrors {
  email?: string
  password?: string
  confirm_password?: string
  first_name?: string
}

const AUTH_FIELD_ERROR_KEYS: ReadonlySet<keyof AuthFormValues> = new Set([
  'email',
  'password',
  'confirm_password',
  'first_name',
])

export const LOCKOUT_KEY = 'lumina:auth_lockout'
export const LOCKOUT_MS = 30 * 60 * 1000 + 30 * 1000
export const MIN_LOADING_MS = 1500
export const FADE_OUT_MS = 300

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const PASSWORD_RULES = [
  { label: '12+ characters', test: (password: string) => password.length >= 12 },
  { label: '1 uppercase letter', test: (password: string) => /[A-Z]/.test(password) },
  { label: '1 lowercase letter', test: (password: string) => /[a-z]/.test(password) },
  { label: '1 number', test: (password: string) => /\d/.test(password) },
  { label: '1 special character', test: (password: string) => /[^A-Za-z0-9\s]/.test(password) },
  { label: 'No spaces', test: (password: string) => !/\s/.test(password) },
]

const ERROR_MESSAGES: Record<string, string> = {
  'Invalid credentials': 'Incorrect email or password. Please try again.',
  'Email already registered': 'An account with this email already exists.',
  'Account temporarily locked': 'Too many failed attempts.',
  'Invalid currency code': 'The selected currency is not supported.',
}

/**
 * Determines the auth mode from the current route path so route changes stay decoupled from form state
 */
export function getAuthMode(pathname: string): AuthMode {
  return pathname === '/signup' ? 'signup' : 'login'
}

/**
 * Builds the initial auth form with detected browser defaults supplied by the page shell
 */
export function buildInitialAuthForm(timezone: string, baseCurrency = 'CAD'): AuthFormValues {
  return {
    email: '',
    password: '',
    confirm_password: '',
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

  if (!form.password) {
    errors.password = 'Password is required'
  } else if (mode === 'signup' && !PASSWORD_RULES.every((rule) => rule.test(form.password))) {
    errors.password = 'Password does not meet requirements'
  }

  if (mode === 'signup') {
    if (!form.first_name.trim()) {
      errors.first_name = 'First name is required'
    }
    if (!form.confirm_password) {
      errors.confirm_password = 'Please confirm your password'
    } else if (form.confirm_password !== form.password) {
      errors.confirm_password = 'Passwords do not match'
    }
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
  const touched: Record<string, boolean> = { email: true, password: true }
  if (mode === 'signup') {
    touched.first_name = true
    touched.confirm_password = true
  }
  return touched
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
    password: form.password,
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
    label: `${currency.id} — ${currency.name} (${currency.symbol})`,
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
 * Promotes signup reference-data failures into the main error surface so the user cannot miss them
 */
export function getDisplayAuthError(
  error: string,
  mode: AuthMode,
  currenciesError: boolean,
  currencyCount: number,
): string {
  if (error) return error
  if (mode === 'signup' && currenciesError && currencyCount === 0) {
    return 'Unable to load currencies. Please refresh and try again.'
  }
  return ''
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
 * Maps backend auth errors into user-facing messages while hiding unrecognised implementation details
 */
export function getAuthErrorMessage(error: unknown): string {
  const message = error instanceof ApiError ? error.message : ''
  return ERROR_MESSAGES[message] ?? 'Something went wrong. Please try again.'
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
