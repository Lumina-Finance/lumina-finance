import { useRef, useState } from 'react'
import { Navigate, useLocation } from 'react-router'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { KeyRound } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRegistrationStatus } from '@/api/auth'
import { useCurrencies } from '@/api/currency'
import { useOidcProviders } from '@/api/oidc'
import { MfaChallenge } from '@/components/two-factor/MfaChallenge'
import { AuthAnimatedTitle } from '@/pages/auth/components/AnimatedTitle'
import { CurrencyRetryWarning } from '@/pages/auth/components/feedback/CurrencyRetryWarning'
import { AuthErrorBanner } from '@/pages/auth/components/feedback/ErrorBanner'
import { OidcProviderButtons } from '@/pages/auth/components/OidcProviderButtons'
import { AuthSignupNameFields } from '@/pages/auth/components/fields/SignupNameFields'
import { AuthSignupReferenceFields } from '@/pages/auth/components/fields/SignupReferenceFields'
import { AuthTextField } from '@/pages/auth/components/fields/TextField'
import {
  AUTH_VIEW_TRANSITION,
  FORGOT_LINK_ANIMATION,
  SIGNUP_FIELD_ANIMATION,
} from '@/pages/auth/constants/authAnimations'
import { useAuthFormWorkflow } from '@/pages/auth/hooks/useAuthFormWorkflow'
import { getAuthMode, REGISTRATION_CLOSED_NOTICE } from '@/pages/auth/utils/authForm'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { getBrowserTimeZone } from '@/utils/date'
import { focusWhenShown } from '@/utils/focusWhenShown'
import { isNativeSignIn, rememberNativeChallenge } from '@/utils/nativeHandoff'
import { buildTimezoneOptions } from '@/utils/timezoneOptions'

const DETECTED_TZ = getBrowserTimeZone()

const TIMEZONES = Intl.supportedValuesOf('timeZone')

/**
 * Renders the auth shell for the login, signup, and forgot-password modes, which share a route key so
 * switching between them morphs the form in place instead of remounting
 */
const AuthPage = () => {
  const location = useLocation()
  const containerRef = useRef<HTMLDivElement>(null)
  const mode = getAuthMode(location.pathname)

  // A provider sign-in that collided with an existing account hands its email over here, and one
  // refused because registration is closed says so
  const handoff = location.state as { prefillEmail?: string; registrationClosed?: boolean } | null
  const prefillEmail = handoff?.prefillEmail
  const isLogin = mode === 'login'
  const isSignup = mode === 'signup'
  const isForgot = mode === 'forgot'
  const {
    data: currencies = [],
    isError: currenciesError,
    isFetching: currenciesFetching,
    refetch: refetchCurrencies,
  } = useCurrencies()
  const {
    currencyPlaceholder,
    displayError,
    fieldErrors,
    form,
    handleBlur,
    handleChange,
    handleSubmit,
    goToForgot,
    forgotRepeated,
    signupRepeated,
    submitDisabled,
    submitBlockReason,
    submitted,
    submitting,
    switchMode,
    touched,
    canUsePasskeys,
    handlePasskeySignIn,
    passkeySigningIn,
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
    passkeyMfaSubmitting,
    switchToAuthenticatorMfa,
    switchToRecoveryMfa,
    switchToPasskeyMfa,
    recoveryMode,
  } = useAuthFormWorkflow({
    containerRef,
    currencies,
    currenciesError,
    detectedTimezone: DETECTED_TZ,
    mode,
    initialEmail: prefillEmail,
  })

  const { data: oidcProviders = [] } = useOidcProviders()

  // Sign-up stays hidden until the server answers on this visit, so a closed instance never flashes
  // it, even to a browser that remembers it open
  const { data: registration, isFetchedAfterMount: registrationKnown } = useRegistrationStatus()
  const registrationOpen = registrationKnown && registration?.enabled === true
  const registrationClosed = registrationKnown && registration?.enabled === false

  // A native app opening this page to sign in for it may also name the provider its user picked
  const [nativeProviderSlug] = useState(() => {
    rememberNativeChallenge(location.search)
    return isNativeSignIn() ? new URLSearchParams(location.search).get('provider') : null
  })

  // Provider sign-in also onboards new users, so the buttons show on signup as well
  const showPasskeyButton = isLogin && canUsePasskeys
  const showOidcButtons = (isLogin || isSignup) && oidcProviders.length > 0

  const submitLabel = isLogin ? 'Log in' : isSignup ? 'Sign up' : 'Send reset link'
  const switchPrompt = isLogin
    ? "Don't have an account? "
    : isForgot
      ? 'Remembered your password? '
      : 'Already have an account? '
  const showSwitchPrompt = !isLogin || registrationOpen

  if (isSignup && registrationClosed) {
    return <Navigate to="/login" replace />
  }

  return (
    <motion.div
      ref={containerRef}
      className="flex min-h-[100dvh] items-start justify-center px-4 pt-[10dvh] lg:pt-[20dvh]"
      style={{ backgroundColor: 'var(--app-bg)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <form onSubmit={mfaActive ? handleMfaSubmit : handleSubmit} className="w-full max-w-sm" noValidate>
        <AuthAnimatedTitle mode={mode} />

        <AuthErrorBanner error={displayError || (handoff?.registrationClosed ? REGISTRATION_CLOSED_NOTICE : null)} />
        {isSignup && (
          <CurrencyRetryWarning
            failed={currenciesError && currencies.length === 0}
            fetching={currenciesFetching}
            onRetry={refetchCurrencies}
          />
        )}

        {recoveryMode && isLogin && (
          <div
            className="mt-4 rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--app-border)', color: 'var(--app-text-muted)' }}
          >
            Recovering access. Sign in, then enter a recovery code to reset your two-factor setup.
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {mfaActive ? (
            <motion.div
              key={`mfa-step-${mfaUsePasskey ? 'passkey' : mfaUseRecoveryCode ? 'recovery' : 'code'}`}
              className="mt-5 space-y-6"
              {...AUTH_VIEW_TRANSITION}
            >
              <MfaChallenge
                challenge={{
                  canEnterAuthenticatorCode: mfaTotpEnabled,
                  canOfferPasskey: mfaPasskeyAvailable,
                  isRecoveryOnly: mfaRecoveryOnly,
                }}
                usePasskey={mfaUsePasskey}
                useRecoveryCode={mfaUseRecoveryCode}
                code={mfaCode}
                onCodeChange={setMfaCode}
                submitting={mfaSubmitting}
                passkeySubmitting={passkeyMfaSubmitting}
                onVerifyPasskey={handlePasskeyMfa}
                onSwitchToAuthenticator={switchToAuthenticatorMfa}
                onSwitchToRecovery={switchToRecoveryMfa}
                onSwitchToPasskey={switchToPasskeyMfa}
                onToggleRecoveryCode={toggleMfaRecoveryCode}
                onCancel={cancelMfa}
                passkeyVerifyDescription="Verify with your passkey to finish signing in."
                hasAncestorForm
              />
            </motion.div>
          ) : isSignup && submitted ? (
            <motion.div
              key="signup-confirmation"
              ref={focusWhenShown}
              tabIndex={-1}
              className="mt-5 space-y-6 outline-none"
              {...AUTH_VIEW_TRANSITION}
            >
              {/* Says the same thing whether or not the address already has an account */}
              <p className="text-base font-medium" role="status">
                Check your email to finish creating your account
              </p>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                We've sent a message to {form.email}. Open its link to finish creating your account before you log in.
                Check your spam folder if it does not arrive.
              </p>
              {signupRepeated && (
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  Already asked for a link today? Use the newest one in your inbox or spam folder.
                </p>
              )}
              <button
                type="button"
                onClick={switchMode}
                className="font-medium underline underline-offset-2 transition-control"
                style={{ color: 'var(--app-accent)' }}
              >
                Back to login
              </button>
            </motion.div>
          ) : isForgot && submitted ? (
            <motion.div
              key="forgot-confirmation"
              ref={focusWhenShown}
              tabIndex={-1}
              className="mt-5 space-y-6 outline-none"
              {...AUTH_VIEW_TRANSITION}
            >
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                If an account exists for {form.email}, a link to set a new password is on its way. Check your inbox.
              </p>
              {forgotRepeated && (
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  Requested a link before? Check your spam folder too. Your most recent link keeps working until it
                  expires, and a new one can only be sent after that.
                </p>
              )}
              <button
                type="button"
                onClick={switchMode}
                className="font-medium underline underline-offset-2 transition-control"
                style={{ color: 'var(--app-accent)' }}
              >
                Back to login
              </button>
            </motion.div>
          ) : (
            <motion.div key="auth-form-body" {...AUTH_VIEW_TRANSITION}>
              <AnimatePresence initial={false}>
                {isForgot && (
                  <motion.p
                    key="forgot-description"
                    className="overflow-hidden text-sm"
                    style={{ color: 'var(--app-text-muted)' }}
                    {...SIGNUP_FIELD_ANIMATION}
                  >
                    Enter your account email and we'll send you a link to set a new password.
                  </motion.p>
                )}
              </AnimatePresence>

              <AuthSignupNameFields
                errors={fieldErrors}
                form={form}
                show={isSignup}
                touched={touched}
                onFieldBlur={handleBlur}
                onFieldChange={handleChange}
              />

              <div className="mt-5">
                <AuthTextField
                  id="email"
                  label="Email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  touched={touched.email}
                  error={fieldErrors.email}
                  onChange={(value) => handleChange('email', value)}
                  onBlur={() => handleBlur('email')}
                />
              </div>

              <AnimatePresence initial={false}>
                {isLogin && (
                  <motion.div key="password-field" className="overflow-hidden" {...SIGNUP_FIELD_ANIMATION}>
                    <AuthTextField
                      id="password"
                      label="Password"
                      type="password"
                      autoComplete="current-password"
                      value={form.password}
                      touched={touched.password}
                      error={fieldErrors.password}
                      onChange={(value) => handleChange('password', value)}
                      onBlur={() => handleBlur('password')}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence initial={false}>
                {isLogin && (
                  <motion.div key="forgot-link" className="-mx-[4px] overflow-hidden" {...FORGOT_LINK_ANIMATION}>
                    <div className="flex justify-end p-[4px]">
                      <button
                        type="button"
                        onClick={goToForgot}
                        className="text-sm font-medium underline underline-offset-2 transition-control"
                        style={{ color: 'var(--app-accent)' }}
                      >
                        Forgot password?
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AuthSignupReferenceFields
                currencies={currencies}
                currencyPlaceholder={currencyPlaceholder}
                form={form}
                show={isSignup}
                timezones={buildTimezoneOptions(TIMEZONES, form.tz)}
                onFieldChange={handleChange}
              />

              <div className="mt-5 flex justify-center">
                <DisabledReasonButton
                  type="submit"
                  disabled={submitDisabled}
                  disabledReason={submitBlockReason}
                  className={`app-primary-button ${submitting ? 'app-primary-button-loading' : 'w-full'}`}
                >
                  <PendingLabel pending={submitting} name={submitLabel}>
                    {submitLabel}
                  </PendingLabel>
                </DisabledReasonButton>
              </div>

              {(showPasskeyButton || showOidcButtons) && (
                <div className="mt-4 space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="h-px flex-1" style={{ backgroundColor: 'var(--app-border)' }} />
                    <span className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
                      or
                    </span>
                    <span className="h-px flex-1" style={{ backgroundColor: 'var(--app-border)' }} />
                  </div>

                  {showPasskeyButton && (
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={handlePasskeySignIn}
                        disabled={passkeySigningIn}
                        className={`app-secondary-button ${passkeySigningIn ? 'app-primary-button-loading' : 'flex w-full items-center justify-center gap-2'}`}
                      >
                        <PendingLabel pending={passkeySigningIn} name="Sign in with a passkey" className="gap-2">
                          <KeyRound size={16} aria-hidden />
                          Sign in with a passkey
                        </PendingLabel>
                      </button>
                    </div>
                  )}

                  {showOidcButtons && (
                    <OidcProviderButtons providers={oidcProviders} autoStartSlug={nativeProviderSlug} />
                  )}
                </div>
              )}

              {showSwitchPrompt && (
                <p className="mt-5 text-center text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  {switchPrompt}
                  <button
                    type="button"
                    onClick={switchMode}
                    className="app-inline-link font-medium underline underline-offset-2 transition-control"
                    style={{ color: 'var(--app-accent)' }}
                  >
                    {isLogin ? 'Sign up' : 'Log in'}
                  </button>
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </form>
    </motion.div>
  )
}

export default AuthPage
