import { useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, animate, AnimatePresence } from 'motion/react';
import { AlertCircle, Check, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import type { AuthResponse } from '@/api/auth';
import { useCurrencies } from '@/api/currency';
import Dropdown from '@/components/Dropdown';
import { waitForMilliseconds } from '@/utils/timing';
import {
  FADE_OUT_MS,
  LOCKOUT_KEY,
  MIN_LOADING_MS,
  PASSWORD_RULES,
  buildCurrencyOptions,
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

// Signup-only fields share animation props so each conditional field enters and exits consistently
const signupFieldAnimation = {
  initial: { height: 0, opacity: 0, marginTop: 0 },
  animate: { height: 'auto', opacity: 1, marginTop: 20 },
  exit: { height: 0, opacity: 0, marginTop: 0 },
  transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const },
};

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

  const switchMode = () => {
    navigate(isLogin ? '/signup' : '/login', { replace: true });
    setError('');
    setFieldErrors({});
    setTouched({});
  };

  const handleBlur = (field: keyof AuthFieldErrors) => {
    setTouched((t) => ({ ...t, [field]: true }));
    const errors = validateAuthFields(form, mode);
    setFieldErrors((prev) => ({ ...prev, [field]: errors[field] }));
  };

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (isAuthFieldErrorKey(field) && fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors = validateAuthFields(form, mode);
    setFieldErrors(errors);
    setTouched(getSubmitTouchedFields(mode));
    if (Object.keys(errors).length > 0) return;

    // Check frontend lockout before hitting the backend
    const remaining = getLockedRemaining();
    if (remaining) {
      setError(`Too many failed attempts. Try again in ${remaining}.`);
      return;
    }

    // Refuse signup if currencies never loaded — otherwise we'd submit the default CAD without the user seeing the options
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
        {/* Lottery wheel title */}
        <div className="overflow-hidden" style={{ height: '2.75rem' }}>
          <AnimatePresence mode="wait">
            <motion.h1
              key={mode}
              className="font-serif text-4xl font-normal tracking-tight flex"
              initial="initial"
              animate="enter"
              exit="exit"
              variants={{
                initial: { transition: { staggerChildren: 0.03 } },
                enter: { transition: { staggerChildren: 0.03 } },
                exit: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
              }}
            >
              {(isLogin ? 'Login' : 'Sign up').split('').map((char, i) => (
                <motion.span
                  key={`${mode}-${i}`}
                  className={char === ' ' ? 'inline-block w-2' : 'inline-block'}
                  variants={{
                    initial: { y: 40, opacity: 0 },
                    enter: { y: 0, opacity: 1 },
                    exit: { y: -40, opacity: 0 },
                  }}
                  transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1.04] }}
                >
                  {char}
                </motion.span>
              ))}
            </motion.h1>
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {displayError && (
            <motion.div
              key="error-banner"
              className="flex items-start gap-3 rounded-xl px-4 py-3"
              style={{
                background: 'var(--app-negative-soft)',
                border: '1px solid var(--app-negative-border)',
              }}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--app-negative)' }} aria-hidden />
              <p className="text-sm" style={{ color: 'var(--app-negative)' }}>{displayError}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Signup-only: name fields */}
        <AnimatePresence>
          {!isLogin && (
            <motion.div className="space-y-5 overflow-hidden" {...signupFieldAnimation}>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <label htmlFor="first_name" className="app-label">First name</label>
                  <AnimatePresence>
                    {touched.first_name && fieldErrors.first_name && (
                      <motion.p
                        key="first_name-error"
                        className="text-xs"
                        style={{ color: 'var(--app-negative)' }}
                        initial={{ opacity: 0, x: 4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 4 }}
                        transition={{ duration: 0.2 }}
                      >
                        {fieldErrors.first_name}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
                <input
                  id="first_name"
                  type="text"
                  autoComplete="given-name"
                  className={`app-input ${touched.first_name && fieldErrors.first_name ? 'app-input-error' : ''}`}
                  value={form.first_name}
                  onChange={(e) => handleChange('first_name', e.target.value)}
                  onBlur={() => handleBlur('first_name')}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="last_name" className="app-label block">Last name <span style={{ color: 'var(--app-text-subtle)' }}>(optional)</span></label>
                <input
                  id="last_name"
                  type="text"
                  autoComplete="family-name"
                  className="app-input"
                  value={form.last_name}
                  onChange={(e) => handleChange('last_name', e.target.value)}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="email" className="app-label">Email</label>
            <AnimatePresence>
              {touched.email && fieldErrors.email && (
                <motion.p
                  key="email-error"
                  className="text-xs"
                  style={{ color: 'var(--app-negative)' }}
                  initial={{ opacity: 0, x: 4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 4 }}
                  transition={{ duration: 0.2 }}
                >
                  {fieldErrors.email}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className={`app-input ${touched.email && fieldErrors.email ? 'app-input-error' : ''}`}
            value={form.email}
            onChange={(e) => handleChange('email', e.target.value)}
            onBlur={() => handleBlur('email')}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="app-label">Password</label>
            <AnimatePresence>
              {touched.password && fieldErrors.password && (
                <motion.p
                  key="password-error"
                  className="text-xs"
                  style={{ color: 'var(--app-negative)' }}
                  initial={{ opacity: 0, x: 4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 4 }}
                  transition={{ duration: 0.2 }}
                >
                  {fieldErrors.password}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          <input
            id="password"
            type="password"
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            className={`app-input ${touched.password && fieldErrors.password ? 'app-input-error' : ''}`}
            value={form.password}
            onChange={(e) => handleChange('password', e.target.value)}
            onFocus={() => setPasswordFocused(true)}
            onBlur={() => { setPasswordFocused(false); handleBlur('password'); }}
          />
          <AnimatePresence>
            {!isLogin && (passwordFocused || form.password.length > 0) && !(touched.password && PASSWORD_RULES.every((r) => r.test(form.password))) && (
              <motion.ul
                className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {PASSWORD_RULES.map((rule) => {
                  const passed = rule.test(form.password);
                  return (
                    <li key={rule.label} className="flex items-center gap-2 text-sm transition-colors duration-200">
                      {passed ? (
                        <Check size={14} strokeWidth={2.5} style={{ color: 'var(--app-accent)' }} aria-hidden />
                      ) : (
                        <X size={14} strokeWidth={2.5} style={{ color: 'var(--app-accent)' }} aria-hidden />
                      )}
                      <span
                        className={passed ? 'line-through' : ''}
                        style={{ color: passed ? 'var(--app-text-subtle)' : 'var(--app-text-muted)' }}
                      >
                        {rule.label}
                      </span>
                    </li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>

        {/* Signup-only: confirm password */}
        <AnimatePresence>
          {!isLogin && (
            <motion.div className="space-y-1.5 overflow-hidden" {...signupFieldAnimation}>
              <div className="flex items-baseline justify-between">
                <label htmlFor="confirm_password" className="app-label">Confirm password</label>
                <AnimatePresence>
                  {touched.confirm_password && fieldErrors.confirm_password && (
                    <motion.p
                      key="confirm_password-error"
                      className="text-xs"
                      style={{ color: 'var(--app-negative)' }}
                      initial={{ opacity: 0, x: 4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 4 }}
                      transition={{ duration: 0.2 }}
                    >
                      {fieldErrors.confirm_password}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
              <input
                id="confirm_password"
                type="password"
                autoComplete="new-password"
                className={`app-input ${touched.confirm_password && fieldErrors.confirm_password ? 'app-input-error' : ''}`}
                value={form.confirm_password}
                onChange={(e) => handleChange('confirm_password', e.target.value)}
                onBlur={() => handleBlur('confirm_password')}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Signup-only: currency picker */}
        <AnimatePresence>
          {!isLogin && (
            <motion.div className="space-y-1.5" {...signupFieldAnimation}>
              <label htmlFor="base_currency" className="app-label block">Base currency</label>
              <Dropdown
                id="base_currency"
                options={buildCurrencyOptions(currencies)}
                value={form.base_currency}
                onChange={(v) => handleChange('base_currency', v)}
                placeholder={currencyPlaceholder}
                searchable
                searchPlaceholder="Search currencies..."
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Signup-only: timezone */}
        <AnimatePresence>
          {!isLogin && (
            <motion.div className="space-y-1.5" {...signupFieldAnimation}>
              <label htmlFor="tz" className="app-label block">Timezone</label>
              <Dropdown
                id="tz"
                options={TIMEZONES}
                value={form.tz}
                onChange={(v) => handleChange('tz', v)}
                searchable
                searchPlaceholder="Search timezones..."
              />
            </motion.div>
          )}
        </AnimatePresence>

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
