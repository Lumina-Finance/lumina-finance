import { useRef, useState, type FormEvent, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { animate } from 'motion/react'
import { forgotPassword, isMfaRequired, type AuthResponse, type LoginResult } from '@/api/auth'
import type { Currency } from '@/api/currency'
import { useAuthenticatePasskey, usePasskeyConfig, useVerifyPasskeyMfa } from '@/api/passkeys'
import { OTP_LENGTH } from '@/components/OtpInput'
import { useAuth } from '@/hooks/useAuth'
import { getPasskeySignInMessage, isPasskeyCeremonyCancelled } from '@/utils/passkeyErrors'
import { assessPasskeySupport } from '@/utils/passkeySupport'
import { delayToMinimum } from '@/utils/timing'
import {
  FADE_OUT_MS,
  LOCKOUT_KEY,
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
  const { login, verifyMfa, signup, setSession, primeAccessToken } = useAuth()
  const passkeyConfig = usePasskeyConfig()
  const passkeySignIn = useAuthenticatePasskey()
  const passkeyMfa = useVerifyPasskeyMfa()
  const navigate = useNavigate()
  const pendingAuthRef = useRef<AuthResponse | null>(null)
  const [form, setForm] = useState<AuthFormValues>(() => buildInitialAuthForm(detectedTimezone))
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [passwordFocused, setPasswordFocused] = useState(false)
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaUseRecoveryCode, setMfaUseRecoveryCode] = useState(false)
  const [mfaRecoveryOnly, setMfaRecoveryOnly] = useState(false)
  const [mfaTotpEnabled, setMfaTotpEnabled] = useState(false)
  const [mfaPasskeyAvailable, setMfaPasskeyAvailable] = useState(false)
  const [mfaUsePasskey, setMfaUsePasskey] = useState(false)
  const [mfaSubmitting, setMfaSubmitting] = useState(false)
  const [enrolling, setEnrolling] = useState(false)

  const isLogin = mode === 'login'
  const mfaActive = mfaToken !== null
  const currencyPlaceholder = getCurrencyPlaceholder(currenciesError, currencies.length)
  const displayError = getDisplayAuthError(error, mode, currenciesError, currencies.length)
  const submitDisabled = isAuthSubmitDisabled(submitting, fieldErrors, mode, currencies.length)

  // The passkey button only shows where a ceremony can actually run, so an unsupported origin such as
  // a bare IP simply offers password login instead of a button that always fails
  const canUsePasskeys =
    passkeyConfig.data !== undefined && assessPasskeySupport(passkeyConfig.data.rp_id).supported

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
   * Clears validation, error, and confirmation state that only belongs to the previous form
   */
  const clearTransientFormState = () => {
    setError('')
    setFieldErrors({})
    setTouched({})
    setSubmitted(false)
  }

  /**
   * Switches between login and signup, clearing state from the previous form
   */
  const switchMode = () => {
    navigate(isLogin ? '/signup' : '/login', { replace: true })
    clearTransientFormState()
  }

  /**
   * Opens the forgot-password form in place, clearing state from the previous form
   */
  const goToForgot = () => {
    navigate('/forgot-password', { replace: true })
    clearTransientFormState()
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

    // Forgot-password sends a reset link and shows a confirmation in place rather than
    // signing the user in, so it skips the lockout, currency, and route-transition steps
    if (mode === 'forgot') {
      setError('')
      setSubmitting(true)
      const forgotStart = Date.now()
      try {
        await forgotPassword({ email: form.email })
      } catch (err) {
        setSubmitting(false)
        setError(getAuthErrorMessage(err))
        return
      }
      await delayToMinimum(forgotStart)
      setSubmitting(false)
      setSubmitted(true)
      return
    }

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
    let res: LoginResult

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

    await delayToMinimum(start)

    // A login that needs a second factor morphs to the verification step instead of completing
    if (isMfaRequired(res)) {
      setSubmitting(false)
      setMfaToken(res.mfa_token)
      setMfaTotpEnabled(res.totp_enabled)
      setMfaPasskeyAvailable(res.passkey_available)

      // The passkey is preferred when present, otherwise a revoked authenticator drops straight to
      // the recovery-code input
      setMfaUsePasskey(res.passkey_available)
      setMfaRecoveryOnly(res.recovery_only)
      setMfaUseRecoveryCode(res.recovery_only)
      return
    }

    // Signup offers a skippable 2FA setup before the app, so the token is primed without
    // committing a session, keeping the auth page mounted rather than redirecting home
    if (!isLogin) {
      setSubmitting(false)
      pendingAuthRef.current = res
      primeAccessToken(res.access_token)
      setEnrolling(true)
      return
    }

    if (containerRef.current) {
      await animate(containerRef.current, { opacity: 0 }, { duration: FADE_OUT_MS / 1000 })
    }
    setSession(res)
    navigate('/', { replace: true })
  }

  /**
   * Signs in with a passkey, committing the session when the assertion verifies
   *
   * A user-verified passkey is complete authentication on its own, so this skips the second-factor
   * step entirely. A cancelled prompt is left silent rather than shown as an error
   */
  const handlePasskeySignIn = async () => {
    setError('')

    let res: AuthResponse
    try {
      res = await passkeySignIn.mutateAsync()
    } catch (err) {
      if (isPasskeyCeremonyCancelled(err)) return
      setError(getPasskeySignInMessage(err))
      return
    }

    if (containerRef.current) {
      await animate(containerRef.current, { opacity: 0 }, { duration: FADE_OUT_MS / 1000 })
    }
    setSession(res)
    navigate('/', { replace: true })
  }

  /**
   * Leaves the signup 2FA step for the app, whether the user enrolled or skipped
   */
  const finishEnrollment = async () => {
    if (containerRef.current) {
      await animate(containerRef.current, { opacity: 0 }, { duration: FADE_OUT_MS / 1000 })
    }
    if (pendingAuthRef.current) {
      setSession(pendingAuthRef.current)
    }
    navigate('/', { replace: true })
  }

  /**
   * Clears every second-factor field, returning the form to the password step
   */
  const resetMfaState = () => {
    setMfaToken(null)
    setMfaCode('')
    setMfaUseRecoveryCode(false)
    setMfaRecoveryOnly(false)
    setMfaUsePasskey(false)
    setMfaTotpEnabled(false)
    setMfaPasskeyAvailable(false)
  }

  /**
   * Verifies the second factor with a passkey, committing the session when it succeeds
   *
   * A cancelled prompt leaves the challenge unspent so the user can retry or switch to a code, while a
   * rejected assertion spends it and drops back to the login form
   */
  const handlePasskeyMfa = async () => {
    if (!mfaToken) return

    setError('')
    let res: AuthResponse
    try {
      res = await passkeyMfa.mutateAsync(mfaToken)
    } catch (err) {
      if (isPasskeyCeremonyCancelled(err)) return
      resetMfaState()
      setError(getPasskeySignInMessage(err))
      return
    }

    if (containerRef.current) {
      await animate(containerRef.current, { opacity: 0 }, { duration: FADE_OUT_MS / 1000 })
    }
    setSession(res)
    navigate('/', { replace: true })
  }

  /**
   * Switches the second-factor step from the passkey to the authenticator code input
   */
  const switchToAuthenticatorMfa = () => {
    setMfaUsePasskey(false)
    setMfaUseRecoveryCode(false)
    setMfaCode('')
    setError('')
  }

  /**
   * Switches the second-factor step to a recovery code
   */
  const switchToRecoveryMfa = () => {
    setMfaUsePasskey(false)
    setMfaUseRecoveryCode(true)
    setMfaCode('')
    setError('')
  }

  /**
   * Switches the second-factor step back to the passkey prompt
   */
  const switchToPasskeyMfa = () => {
    setMfaUsePasskey(true)
    setMfaCode('')
    setError('')
  }

  /**
   * Exchanges the entered code for a session, returning to the login form when it is rejected
   */
  const handleMfaSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    // A recovery code is a free-form string while an authenticator code is a fixed-length number
    const code = mfaUseRecoveryCode ? mfaCode.trim() : mfaCode
    const codeReady = mfaUseRecoveryCode ? code.length > 0 : code.length >= OTP_LENGTH
    if (!mfaToken || !codeReady) return

    setMfaSubmitting(true)
    const start = Date.now()
    let res: AuthResponse
    try {
      res = await verifyMfa({ mfa_token: mfaToken, code })
    } catch (err) {
      // The challenge is single-use, so a rejected code sends the user back to log in afresh
      await delayToMinimum(start)
      setMfaSubmitting(false)
      resetMfaState()
      setError(getAuthErrorMessage(err))
      return
    }

    await delayToMinimum(start)
    if (containerRef.current) {
      await animate(containerRef.current, { opacity: 0 }, { duration: FADE_OUT_MS / 1000 })
    }
    setSession(res)
    navigate('/', { replace: true })
  }

  /**
   * Abandons the second-factor step and returns to the login form
   */
  const cancelMfa = () => {
    resetMfaState()
    setError('')
  }

  /**
   * Switches the second-factor input between an authenticator code and a recovery code
   */
  const toggleMfaRecoveryCode = () => {
    setMfaUseRecoveryCode((current) => !current)
    setMfaCode('')
    setError('')
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
    goToForgot,
    isLogin,
    passwordFocused,
    setPasswordFocused,
    submitDisabled,
    submitted,
    submitting,
    switchMode,
    touched,
    canUsePasskeys,
    handlePasskeySignIn,
    passkeySigningIn: passkeySignIn.isPending,
    mfaActive,
    mfaCode,
    setMfaCode,
    mfaUseRecoveryCode,
    toggleMfaRecoveryCode,
    mfaRecoveryOnly,
    mfaSubmitting,
    handleMfaSubmit,
    cancelMfa,
    mfaUsePasskey,
    mfaPasskeyAvailable,
    mfaTotpEnabled,
    handlePasskeyMfa,
    passkeyMfaSubmitting: passkeyMfa.isPending,
    switchToAuthenticatorMfa,
    switchToRecoveryMfa,
    switchToPasskeyMfa,
    enrolling,
    finishEnrollment,
  }
}
