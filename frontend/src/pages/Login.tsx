import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, animate, AnimatePresence } from 'motion/react';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/api/auth';
import type { AuthResponse } from '@/api/auth';

const MIN_LOADING_MS = 1500;
const FADE_OUT_MS = 300;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = 'login' | 'signup';

interface FieldErrors {
  email?: string;
  password?: string;
}

function validateFields(form: { email: string; password: string }): FieldErrors {
  const errors: FieldErrors = {};

  if (!form.email) {
    errors.email = 'Email is required';
  } else if (!EMAIL_RE.test(form.email)) {
    errors.email = 'Enter a valid email address';
  }

  if (!form.password) {
    errors.password = 'Password is required';
  }

  return errors;
}

const Login = () => {
  const { login, signup, setSession } = useAuth();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>('login');
  // Track scroll direction: 1 = up (login→signup), -1 = down (signup→login)
  const [direction, setDirection] = useState(1);

  const [form, setForm] = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const switchMode = () => {
    const next = mode === 'login' ? 'signup' : 'login';
    setDirection(next === 'signup' ? 1 : -1);
    setMode(next);
    setError('');
    setFieldErrors({});
    setTouched({});
  };

  const handleBlur = (field: keyof FieldErrors) => {
    setTouched((t) => ({ ...t, [field]: true }));
    const errors = validateFields(form);
    setFieldErrors((prev) => ({ ...prev, [field]: errors[field] }));
  };

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (fieldErrors[field as keyof FieldErrors]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors = validateFields(form);
    setFieldErrors(errors);
    setTouched({ email: true, password: true });
    if (Object.keys(errors).length > 0) return;

    setError('');
    setSubmitting(true);

    const start = Date.now();
    let res: AuthResponse;

    try {
      if (mode === 'login') {
        res = await login(form);
      } else {
        res = await signup({
          ...form,
          first_name: '',
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          base_currency: 'CAD',
        });
      }
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      return;
    }

    const elapsed = Date.now() - start;
    if (elapsed < MIN_LOADING_MS) {
      await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed));
    }

    if (containerRef.current) {
      await animate(containerRef.current, { opacity: 0 }, { duration: FADE_OUT_MS / 1000 });
    }
    setSession(res);
    navigate('/', { replace: true });
  };

  const isLogin = mode === 'login';

  return (
    <motion.div
      ref={containerRef}
      className="flex min-h-screen items-center justify-center px-4"
      style={{ backgroundColor: 'var(--app-bg)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5" noValidate>
        {/* Lottery wheel title — per-letter stagger */}
        <div className="overflow-hidden" style={{ height: '2.75rem' }}>
          <AnimatePresence mode="wait" custom={direction}>
            <motion.h1
              key={mode}
              className="font-serif text-4xl font-light tracking-tight flex"
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

        {error && (
          <p className="text-sm" style={{ color: 'var(--app-negative)' }}>{error}</p>
        )}

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
            onBlur={() => handleBlur('password')}
          />
        </div>

        <div className="flex justify-center">
          <button
            type="submit"
            disabled={submitting || Object.values(fieldErrors).some(Boolean)}
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

export default Login;
