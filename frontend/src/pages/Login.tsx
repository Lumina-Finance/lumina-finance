import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, animate, AnimatePresence } from 'motion/react';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/api/auth';
import type { AuthResponse } from '@/api/auth';

const MIN_LOADING_MS = 1500;
const FADE_OUT_MS = 300;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const { login, setSession } = useAuth();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleBlur = (field: keyof FieldErrors) => {
    setTouched((t) => ({ ...t, [field]: true }));
    const errors = validateFields(form);
    setFieldErrors((prev) => ({ ...prev, [field]: errors[field] }));
  };

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    // Clear field error as user types
    if (fieldErrors[field as keyof FieldErrors]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields on submit
    const errors = validateFields(form);
    setFieldErrors(errors);
    setTouched({ email: true, password: true });
    if (Object.keys(errors).length > 0) return;

    setError('');
    setSubmitting(true);

    const start = Date.now();
    let res: AuthResponse;

    try {
      res = await login(form);
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
        <h1 className="font-serif text-4xl font-light tracking-tight">Login</h1>

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
            autoComplete="current-password"
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
            {submitting ? <div className="app-spinner" /> : 'Log in'}
          </button>
        </div>
      </form>
    </motion.div>
  );
};

export default Login;
