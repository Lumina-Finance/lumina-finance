import { useState, type FormEvent, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { animate } from 'motion/react'
import type { AuthResponse } from '@/api/auth'
import type { Currency } from '@/api/currency'
import { useAuth } from '@/hooks/useAuth'
import { waitForMilliseconds } from '@/utils/timing'
import {
  FADE_OUT_MS,
  LOCKOUT_KEY,
  MIN_LOADING_MS,
  buildInitialAuthForm,
  buildLoginPayload,
  buildSignupPayload,
  getAuthErrorMessage,
  getCurrencyPlaceholder,
  getDisplayAuthError,
  getLockoutExpiry,
  getLockoutRemainingLabel,
  getSubmitTouchedFields,
  isAuthFieldErrorKey,
  isAuthLockoutError,
  isAuthSubmitDisabled,
  validateAuthFields,
  type AuthFieldErrors,
  type AuthFormValues,
  type AuthMode,
} from '@/pages/auth/utils/authForm'

interface UseAuthFormWorkflowParams {
  containerRef: RefObject<HTMLDivElement | null>
  currencies: Currency[]
  currenciesError: boolean
  detectedTimezone: string
  mode: AuthMode
}

/**
 * Coordinates auth form state, local lockout checks, submit requests, and the post-auth route transition
 */
export function useAuthFormWorkflow({
  containerRef,
  currencies,
  currenciesError,
  detectedTimezone,
  mode,
}: UseAuthFormWorkflowParams) {
  const { login, signup, setSession } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState<AuthFormValues>(() => buildInitialAuthForm(detectedTimezone))
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [passwordFocused, setPasswordFocused] = useState(false)

  const isLogin = mode === 'login'
  const currencyPlaceholder = getCurrencyPlaceholder(currenciesError, currencies.length)
  const displayError = getDisplayAuthError(error, mode, currenciesError, currencies.length)
  const submitDisabled = isAuthSubmitDisabled(submitting, fieldErrors, mode, currencies.length)

  /**
   * Returns the remaining local lockout time and clears expired lockout state
   */
  const getLockedRemaining = (): string | null => {
    const stored = localStorage.getItem(LOCKOUT_KEY)
    const remaining = getLockoutRemainingLabel(stored, Date.now())
    if (!remaining && stored) {
      localStorage.removeItem(LOCKOUT_KEY)
    }
    return remaining
  }

  /**
   * Switches auth mode while clearing state that only belongs to the previous form
   */
  const switchMode = () => {
    navigate(isLogin ? '/signup' : '/login', { replace: true })
    setError('')
    setFieldErrors({})
    setTouched({})
  }

  /**
   * Marks one field as touched and refreshes its validation message against the current mode
   */
  const handleBlur = (field: keyof AuthFieldErrors) => {
    setTouched((current) => ({ ...current, [field]: true }))
    const errors = validateAuthFields(form, mode)
    setFieldErrors((current) => ({ ...current, [field]: errors[field] }))
  }

  /**
   * Updates one form field and clears stale validation tied to editable error fields
   */
  const handleChange = (field: keyof AuthFormValues, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    if (isAuthFieldErrorKey(field) && fieldErrors[field]) {
      setFieldErrors((current) => ({ ...current, [field]: undefined }))
    }
  }

  /**
   * Leaves password focus state and validates the current password field
   */
  const handlePasswordBlur = () => {
    setPasswordFocused(false)
    handleBlur('password')
  }

  /**
   * Validates the form, enforces local lockout and currency guards, then starts the authenticated route transition
   */
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const errors = validateAuthFields(form, mode)
    setFieldErrors(errors)
    setTouched(getSubmitTouchedFields(mode))
    if (Object.keys(errors).length > 0) return

    // The browser mirrors backend lockout state before another request is sent
    const remaining = getLockedRemaining()
    if (remaining) {
      setError(`Too many failed attempts. Try again in ${remaining}.`)
      return
    }

    // Signup waits for currencies so the default currency is not submitted without visible options
    if (!isLogin && currencies.length === 0) {
      setError('Unable to load currencies. Please refresh and try again.')
      return
    }

    setError('')
    setSubmitting(true)

    const start = Date.now()
    let res: AuthResponse

    try {
      res = isLogin
        ? await login(buildLoginPayload(form))
        : await signup(buildSignupPayload(form))
    } catch (err) {
      setSubmitting(false)
      if (isAuthLockoutError(err)) {
        localStorage.setItem(LOCKOUT_KEY, String(getLockoutExpiry(Date.now())))
      }
      setError(getAuthErrorMessage(err))
      return
    }

    const elapsed = Date.now() - start
    if (elapsed < MIN_LOADING_MS) {
      await waitForMilliseconds(MIN_LOADING_MS - elapsed)
    }

    if (containerRef.current) {
      await animate(containerRef.current, { opacity: 0 }, { duration: FADE_OUT_MS / 1000 })
    }
    setSession(res)
    navigate('/', { replace: true })
  }

  return {
    currencyPlaceholder,
    displayError,
    fieldErrors,
    form,
    handleBlur,
    handleChange,
    handlePasswordBlur,
    handleSubmit,
    isLogin,
    passwordFocused,
    setPasswordFocused,
    submitDisabled,
    submitting,
    switchMode,
    touched,
  }
}
