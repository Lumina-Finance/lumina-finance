import { useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCurrencies } from '@/api/currency';
import { OtpInput, OTP_LENGTH } from '@/components/OtpInput';
import { TotpEnrollment } from '@/components/twoFactor/TotpEnrollment';
import { WarningCallout } from '@/components/twoFactor/WarningCallout';
import { AuthAnimatedTitle } from '@/pages/auth/components/AnimatedTitle';
import { AuthConfirmPasswordField } from '@/pages/auth/components/fields/ConfirmPasswordField';
import { AuthErrorBanner } from '@/pages/auth/components/feedback/ErrorBanner';
import { AuthSignupNameFields } from '@/pages/auth/components/fields/SignupNameFields';
import { AuthSignupReferenceFields } from '@/pages/auth/components/fields/SignupReferenceFields';
import { AuthTextField } from '@/pages/auth/components/fields/TextField';
import { PasswordRequirements } from '@/pages/auth/components/feedback/PasswordRequirements';
import { AUTH_VIEW_TRANSITION, SIGNUP_FIELD_ANIMATION } from '@/pages/auth/constants/authAnimations';
import { useAuthFormWorkflow } from '@/pages/auth/hooks/useAuthFormWorkflow';
import { getAuthMode } from '@/pages/auth/utils/authForm';

const DETECTED_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const TIMEZONES = Intl.supportedValuesOf('timeZone').map((tz) => ({
  value: tz,
  label: tz.replace(/_/g, ' '),
}));

/**
 * Renders the auth shell for the login, signup, and forgot-password modes, which share a route key so
 * switching between them morphs the form in place instead of remounting
 */
const AuthPage = () => {
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mode = getAuthMode(location.pathname);
  const isLogin = mode === 'login';
  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';
  const { data: currencies = [], isError: currenciesError } = useCurrencies();
  const {
    currencyPlaceholder,
    displayError,
    fieldErrors,
    form,
    handleBlur,
    handleChange,
    handlePasswordBlur,
    handleSubmit,
    goToForgot,
    passwordFocused,
    setPasswordFocused,
    submitDisabled,
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
    enrolling,
    finishEnrollment,
  } = useAuthFormWorkflow({
    containerRef,
    currencies,
    currenciesError,
    detectedTimezone: DETECTED_TZ,
    mode,
  });

  const submitLabel = isLogin ? 'Log in' : isSignup ? 'Sign up' : 'Send reset link';
  const switchPrompt = isLogin
    ? "Don't have an account? "
    : isForgot
      ? 'Remembered your password? '
      : 'Already have an account? ';

  return (
    <motion.div
      ref={containerRef}
      className="flex min-h-[100dvh] items-start justify-center px-4 pt-[10dvh] lg:pt-[20dvh]"
      style={{ backgroundColor: 'var(--app-bg)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <form
        onSubmit={(event) => {
          if (enrolling) {
            event.preventDefault();
            return;
          }
          (mfaActive ? handleMfaSubmit : handleSubmit)(event);
        }}
        className="w-full max-w-sm"
        noValidate
      >
        <AuthAnimatedTitle mode={mode} />

        <AuthErrorBanner error={displayError} />

        <AnimatePresence mode="wait" initial={false}>
          {enrolling ? (
            <motion.div key="totp-enrollment" className="mt-5" {...AUTH_VIEW_TRANSITION}>
              <TotpEnrollment onComplete={finishEnrollment} onSkip={finishEnrollment} />
            </motion.div>
          ) : mfaActive ? (
            <motion.div key="mfa-code" className="mt-5 space-y-6" {...AUTH_VIEW_TRANSITION}>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                {mfaRecoveryOnly
                  ? 'Your authenticator was removed. Enter a recovery code to continue.'
                  : mfaUseRecoveryCode
                    ? 'Enter one of your recovery codes.'
                    : 'Enter the 6-digit code from your authenticator app.'}
              </p>

              {mfaUseRecoveryCode && (
                <WarningCallout>
                  {mfaRecoveryOnly
                    ? "Each recovery-code sign-in spends one of your remaining codes. If you run out before you set up a new authenticator, you'll be permanently locked out of your account."
                    : "Using a recovery code removes your current authenticator. You'll be required to set up a new one before you can access your account again."}
                </WarningCallout>
              )}

              {mfaUseRecoveryCode ? (
                <input
                  className="app-input w-full"
                  placeholder="Recovery code"
                  // A recovery code is not a TOTP code, so suppress one-time-code autofill from password managers
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                  disabled={mfaSubmitting}
                  autoFocus
                />
              ) : (
                <OtpInput value={mfaCode} onChange={setMfaCode} disabled={mfaSubmitting} autoFocus />
              )}

              <div className="flex justify-center">
                <button
                  type="submit"
                  disabled={
                    mfaSubmitting ||
                    (mfaUseRecoveryCode ? mfaCode.trim().length === 0 : mfaCode.length < OTP_LENGTH)
                  }
                  className={`app-primary-button transition-all duration-300 ${
                    mfaSubmitting ? 'app-primary-button-loading' : 'w-full'
                  }`}
                >
                  {mfaSubmitting ? <div className="app-spinner" /> : 'Verify'}
                </button>
              </div>

              {!mfaRecoveryOnly && (
                <button
                  type="button"
                  onClick={toggleMfaRecoveryCode}
                  className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-colors duration-200"
                  style={{ color: 'var(--app-accent)' }}
                >
                  {mfaUseRecoveryCode ? 'Use authenticator code' : 'Enter a recovery code instead'}
                </button>
              )}

              <button
                type="button"
                onClick={cancelMfa}
                className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-colors duration-200"
                style={{ color: 'var(--app-text-muted)' }}
              >
                Back to login
              </button>
            </motion.div>
          ) : isForgot && submitted ? (
            <motion.div key="forgot-confirmation" className="mt-5 space-y-6" {...AUTH_VIEW_TRANSITION}>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                If an account exists for {form.email}, a link to set a new password is on its way. Check your inbox.
              </p>
              <button
                type="button"
                onClick={switchMode}
                className="font-medium underline underline-offset-2 transition-colors duration-200"
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
                {!isForgot && (
                  <motion.div key="password-field" className="overflow-hidden" {...SIGNUP_FIELD_ANIMATION}>
                    <AuthTextField
                      id="password"
                      label="Password"
                      type="password"
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                      value={form.password}
                      touched={touched.password}
                      error={fieldErrors.password}
                      onChange={(value) => handleChange('password', value)}
                      onFocus={() => setPasswordFocused(true)}
                      onBlur={handlePasswordBlur}
                    />
                    {isSignup && (
                      <PasswordRequirements
                        focused={passwordFocused}
                        password={form.password}
                        touched={touched.password}
                      />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence initial={false}>
                {isLogin && (
                  <motion.div
                    key="forgot-link"
                    className="flex justify-end overflow-hidden"
                    {...SIGNUP_FIELD_ANIMATION}
                  >
                    <button
                      type="button"
                      onClick={goToForgot}
                      className="text-sm font-medium underline underline-offset-2 transition-colors duration-200"
                      style={{ color: 'var(--app-accent)' }}
                    >
                      Forgot password?
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              <AuthConfirmPasswordField
                show={isSignup}
                value={form.confirm_password}
                touched={touched.confirm_password}
                error={fieldErrors.confirm_password}
                onFieldBlur={handleBlur}
                onFieldChange={handleChange}
              />

              <AuthSignupReferenceFields
                currencies={currencies}
                currencyPlaceholder={currencyPlaceholder}
                form={form}
                show={isSignup}
                timezones={TIMEZONES}
                onFieldChange={handleChange}
              />

              <div className="mt-5 flex justify-center">
                <button
                  type="submit"
                  disabled={submitDisabled}
                  className={`app-primary-button transition-all duration-300 ${
                    submitting ? 'app-primary-button-loading' : 'w-full'
                  }`}
                >
                  {submitting ? <div className="app-spinner" /> : submitLabel}
                </button>
              </div>

              {isLogin && canUsePasskeys && (
                <div className="mt-4 space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="h-px flex-1" style={{ backgroundColor: 'var(--app-border)' }} />
                    <span className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
                      or
                    </span>
                    <span className="h-px flex-1" style={{ backgroundColor: 'var(--app-border)' }} />
                  </div>

                  <button
                    type="button"
                    onClick={handlePasskeySignIn}
                    disabled={passkeySigningIn}
                    className="app-secondary-button flex w-full items-center justify-center gap-2"
                  >
                    {passkeySigningIn ? (
                      <div className="app-spinner" />
                    ) : (
                      <>
                        <KeyRound size={16} aria-hidden />
                        Sign in with a passkey
                      </>
                    )}
                  </button>
                </div>
              )}

              <p className="mt-5 text-center text-sm" style={{ color: 'var(--app-text-muted)' }}>
                {switchPrompt}
                <button
                  type="button"
                  onClick={switchMode}
                  className="font-medium underline underline-offset-2 transition-colors duration-200"
                  style={{ color: 'var(--app-accent)' }}
                >
                  {isLogin ? 'Sign up' : 'Log in'}
                </button>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </form>
    </motion.div>
  );
};

export default AuthPage;
