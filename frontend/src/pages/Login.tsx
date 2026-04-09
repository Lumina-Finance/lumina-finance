import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, animate } from 'motion/react';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/api/auth';
import type { AuthResponse } from '@/api/auth';

const MIN_LOADING_MS = 1500;
const FADE_OUT_MS = 300;

const Login = () => {
  const { login, setSession } = useAuth();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

    // Ensure the spinner shows for at least MIN_LOADING_MS
    const elapsed = Date.now() - start;
    if (elapsed < MIN_LOADING_MS) {
      await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed));
    }

    // Fade out, then commit session and navigate
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
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <h1 className="font-serif text-4xl font-light tracking-tight">Login</h1>

        {error && (
          <p className="text-sm" style={{ color: 'var(--app-negative)' }}>{error}</p>
        )}

        <div className="space-y-1.5">
          <label htmlFor="email" className="app-label block">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            className="app-input"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="app-label block">Password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            className="app-input"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          />
        </div>

        <div className="flex justify-center">
          <button
            type="submit"
            disabled={submitting}
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
