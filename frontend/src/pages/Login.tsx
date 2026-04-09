import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/api/auth';

const MIN_LOADING_MS = 1500;

const Login = () => {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const start = Date.now();

    try {
      await login(form);
      // Ensure the spinner shows for at least MIN_LOADING_MS
      const elapsed = Date.now() - start;
      if (elapsed < MIN_LOADING_MS) {
        await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed));
      }
      navigate('/', { replace: true });
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ backgroundColor: 'var(--app-bg)' }}
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
    </div>
  );
};

export default Login;
