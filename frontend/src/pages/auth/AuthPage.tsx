import { useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { useCurrencies } from '@/api/currency';
import { AuthAnimatedTitle } from '@/pages/auth/components/AnimatedTitle';
import { AuthConfirmPasswordField } from '@/pages/auth/components/fields/ConfirmPasswordField';
import { AuthErrorBanner } from '@/pages/auth/components/feedback/ErrorBanner';
import { AuthSignupNameFields } from '@/pages/auth/components/fields/SignupNameFields';
import { AuthSignupReferenceFields } from '@/pages/auth/components/fields/SignupReferenceFields';
import { AuthTextField } from '@/pages/auth/components/fields/TextField';
import { PasswordRequirements } from '@/pages/auth/components/feedback/PasswordRequirements';
import { useAuthFormWorkflow } from '@/pages/auth/hooks/useAuthFormWorkflow';
import { getAuthMode } from '@/pages/auth/utils/authForm';

const DETECTED_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const TIMEZONES = Intl.supportedValuesOf('timeZone').map((tz) => ({
  value: tz,
  label: tz.replace(/_/g, ' '),
}));

/**
 * Renders the auth page shell and wires the workflow hook into the form sections
 */
const AuthPage = () => {
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mode = getAuthMode(location.pathname);
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
    isLogin,
    passwordFocused,
    setPasswordFocused,
    submitDisabled,
    submitting,
    switchMode,
    touched,
  } = useAuthFormWorkflow({
    containerRef,
    currencies,
    currenciesError,
    detectedTimezone: DETECTED_TZ,
    mode,
  });

  return (
    <motion.div
      ref={containerRef}
      className="flex min-h-[100dvh] items-start justify-center px-4 pt-[10dvh] lg:pt-[20dvh]"
      style={{ backgroundColor: 'var(--app-bg)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <form onSubmit={handleSubmit} className="w-full max-w-sm" noValidate>
        <AuthAnimatedTitle mode={mode} />

        <AuthErrorBanner error={displayError} />

        <AuthSignupNameFields
          errors={fieldErrors}
          form={form}
          show={!isLogin}
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

        <div className="mt-5">
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
          {!isLogin && (
            <PasswordRequirements
              focused={passwordFocused}
              password={form.password}
              touched={touched.password}
            />
          )}
        </div>

        <AuthConfirmPasswordField
          show={!isLogin}
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
          show={!isLogin}
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
            {submitting ? <div className="app-spinner" /> : isLogin ? 'Log in' : 'Sign up'}
          </button>
        </div>

        <p className="mt-5 text-center text-sm" style={{ color: 'var(--app-text-muted)' }}>
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={switchMode}
            className="font-medium underline underline-offset-2 transition-colors duration-200"
            style={{ color: 'var(--app-accent)' }}
          >
            {isLogin ? 'Sign up' : 'Log in'}
          </button>
        </p>
      </form>
    </motion.div>
  );
};

export default AuthPage;
