import { useRef } from 'react';
import { useLocation } from 'react-router';
import { KeyRound } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCurrencies } from '@/api/currency';
import { useOidcProviders } from '@/api/oidc';
import { MfaChallenge } from '@/components/two-factor/MfaChallenge';
import { SignupFactorSetup } from '@/pages/auth/components/SignupFactorSetup';
import { AuthAnimatedTitle } from '@/pages/auth/components/AnimatedTitle';
import { AuthConfirmPasswordField } from '@/pages/auth/components/fields/ConfirmPasswordField';
import { AuthErrorBanner } from '@/pages/auth/components/feedback/ErrorBanner';
import { OidcProviderButtons } from '@/pages/auth/components/OidcProviderButtons';
import { AuthSignupNameFields } from '@/pages/auth/components/fields/SignupNameFields';
import { AuthSignupReferenceFields } from '@/pages/auth/components/fields/SignupReferenceFields';
import { AuthTextField } from '@/pages/auth/components/fields/TextField';
import { PasswordRequirements } from '@/components/PasswordRequirements';
import { AUTH_VIEW_TRANSITION, SIGNUP_FIELD_ANIMATION } from '@/pages/auth/constants/authAnimations';
import { useAuthFormWorkflow } from '@/pages/auth/hooks/useAuthFormWorkflow';
import { getAuthMode } from '@/pages/auth/utils/authForm';
import { isNewPasswordValid } from '@/utils/passwordPolicy';

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

  // A provider sign-in that collided with an existing account hands its email over here
  const prefillEmail = (location.state as { prefillEmail?: string } | null)?.prefillEmail;
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
    forgotRepeated,
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
    mfaUsePasskey,
    mfaPasskeyAvailable,
    mfaTotpEnabled,
    handlePasskeyMfa,
    passkeyMfaSubmitting,
    switchToAuthenticatorMfa,
    switchToRecoveryMfa,
    switchToPasskeyMfa,
    enrolling,
    finishEnrollment,
    recoveryMode,
  } = useAuthFormWorkflow({
    containerRef,
    currencies,
    currenciesError,
    detectedTimezone: DETECTED_TZ,
    mode,
    initialEmail: prefillEmail,
  });

  const { data: oidcProviders = [] } = useOidcProviders();

  // Provider sign-in also onboards new users, so the buttons show on signup as well
  const showPasskeyButton = isLogin && canUsePasskeys;
  const showOidcButtons = (isLogin || isSignup) && oidcProviders.length > 0;

  // The checklist stays open while the field is focused or has content, and hides once the password
  // has been touched and satisfies every rule
  const passwordRequirementsVisible =
    (passwordFocused || form.password.length > 0) && !(touched.password && isNewPasswordValid(form.password));

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

        {recoveryMode && isLogin && !enrolling && (
          <div
            className="mt-4 rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--app-border)', color: 'var(--app-text-muted)' }}
          >
            Recovering access. Sign in, then enter a recovery code to reset your two-factor setup.
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {enrolling ? (
            <motion.div key="factor-enrollment" className="mt-5" {...AUTH_VIEW_TRANSITION}>
              {/* Opt-in 2FA at signup is the account's first factor, so it steps up with the password just set */}
              <SignupFactorSetup
                passkeysSupported={canUsePasskeys}
                setupStepUp={{ password: form.password }}
                onFinish={finishEnrollment}
              />
            </motion.div>
          ) : mfaActive ? (
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
          ) : isForgot && submitted ? (
            <motion.div key="forgot-confirmation" className="mt-5 space-y-6" {...AUTH_VIEW_TRANSITION}>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                If an account exists for {form.email}, a link to set a new password is on its way. Check your inbox.
              </p>
              {forgotRepeated && (
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  Requested a link before? Check your spam folder too. Your most recent link keeps
                  working until it expires, and a new one can only be sent after that.
                </p>
              )}
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
                        password={form.password}
                        visible={passwordRequirementsVisible}
                        animated
                        className="mt-2 space-y-1"
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
                        className={`app-secondary-button transition-all duration-300 ${passkeySigningIn ? 'app-primary-button-loading' : 'flex w-full items-center justify-center gap-2'}`}
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

                  {showOidcButtons && <OidcProviderButtons providers={oidcProviders} />}
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
