import { useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, animate } from 'motion/react';
import { useAuth } from '@/hooks/useAuth';
import type { AuthResponse } from '@/api/auth';
import { useCurrencies } from '@/api/currency';
import { waitForMilliseconds } from '@/utils/timing';
import { AuthAnimatedTitle } from './auth/AuthAnimatedTitle';
import { AuthConfirmPasswordField } from './auth/AuthConfirmPasswordField';
import { AuthErrorBanner } from './auth/AuthErrorBanner';
import { AuthSignupNameFields } from './auth/AuthSignupNameFields';
import { AuthSignupReferenceFields } from './auth/AuthSignupReferenceFields';
import { AuthTextField } from './auth/AuthTextField';
import { PasswordRequirements } from './auth/PasswordRequirements';
import {
  FADE_OUT_MS,
  LOCKOUT_KEY,
  MIN_LOADING_MS,
  buildInitialAuthForm,
  buildLoginPayload,
  buildSignupPayload,
  getAuthErrorMessage,
  getAuthMode,
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
} from './auth/authForm';

const DETECTED_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const TIMEZONES = Intl.supportedValuesOf('timeZone').map((tz) => ({
  value: tz,
  label: tz.replace(/_/g, ' '),
}));

/**
 * Coordinates auth page state, submit orchestration, and the route transition after login or signup
 */
const Auth = () => {
  const { login, signup, setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  const mode = getAuthMode(location.pathname);

  const [form, setForm] = useState<AuthFormValues>(() => buildInitialAuthForm(DETECTED_TZ));
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const { data: currencies = [], isError: currenciesError } = useCurrencies();

  const isLogin = mode === 'login';

  const currencyPlaceholder = getCurrencyPlaceholder(currenciesError, currencies.length);
  const displayError = getDisplayAuthError(error, mode, currenciesError, currencies.length);

  /**
   * Returns the remaining local lockout time and clears expired lockout state
   */
  const getLockedRemaining = (): string | null => {
    const stored = localStorage.getItem(LOCKOUT_KEY);
    const remaining = getLockoutRemainingLabel(stored, Date.now());
    if (!remaining && stored) {
      localStorage.removeItem(LOCKOUT_KEY);
    }
    return remaining;
  };

  /**
   * Switches auth mode while clearing state that only belongs to the previous form
   */
  const switchMode = () => {
    navigate(isLogin ? '/signup' : '/login', { replace: true });
    setError('');
    setFieldErrors({});
    setTouched({});
  };

  /**
   * Marks one field as touched and refreshes its validation message against the current mode
   */
  const handleBlur = (field: keyof AuthFieldErrors) => {
    setTouched((t) => ({ ...t, [field]: true }));
    const errors = validateAuthFields(form, mode);
    setFieldErrors((prev) => ({ ...prev, [field]: errors[field] }));
  };

  /**
   * Updates one form field and clears stale validation tied to editable error fields
   */
  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (isAuthFieldErrorKey(field) && fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  /**
   * Leaves password focus state and validates the current password field
   */
  const handlePasswordBlur = () => {
    setPasswordFocused(false);
    handleBlur('password');
  };

  /**
   * Validates the form, enforces local lockout and currency guards, then starts the authenticated route transition
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors = validateAuthFields(form, mode);
    setFieldErrors(errors);
    setTouched(getSubmitTouchedFields(mode));
    if (Object.keys(errors).length > 0) return;

    // The browser mirrors backend lockout state before another request is sent
    const remaining = getLockedRemaining();
    if (remaining) {
      setError(`Too many failed attempts. Try again in ${remaining}.`);
      return;
    }

    // Signup waits for currencies so the default currency is not submitted without visible options
    if (!isLogin && currencies.length === 0) {
      setError('Unable to load currencies. Please refresh and try again.');
      return;
    }

    setError('');
    setSubmitting(true);

    const start = Date.now();
    let res: AuthResponse;

    try {
      res = isLogin
        ? await login(buildLoginPayload(form))
        : await signup(buildSignupPayload(form));
    } catch (err) {
      setSubmitting(false);
      if (isAuthLockoutError(err)) {
        localStorage.setItem(LOCKOUT_KEY, String(getLockoutExpiry(Date.now())));
      }
      setError(getAuthErrorMessage(err));
      return;
    }

    const elapsed = Date.now() - start;
    if (elapsed < MIN_LOADING_MS) {
      await waitForMilliseconds(MIN_LOADING_MS - elapsed);
    }

    if (containerRef.current) {
      await animate(containerRef.current, { opacity: 0 }, { duration: FADE_OUT_MS / 1000 });
    }
    setSession(res);
    navigate('/', { replace: true });
  };

  return (
    <motion.div
      ref={containerRef}
      className="flex min-h-[100dvh] items-start justify-center px-4 pt-[10dvh] lg:pt-[20dvh]"
      style={{ backgroundColor: 'var(--app-bg)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5" noValidate>
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

        <div>
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

        <div className="flex justify-center">
          <button
            type="submit"
            disabled={isAuthSubmitDisabled(submitting, fieldErrors, mode, currencies.length)}
            className={`app-primary-button transition-all duration-300 ${
              submitting ? 'app-primary-button-loading' : 'w-full'
            }`}
          >
            {submitting ? <div className="app-spinner" /> : isLogin ? 'Log in' : 'Sign up'}
          </button>
        </div>

        <p className="text-center text-sm" style={{ color: 'var(--app-text-muted)' }}>
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

export default Auth;
