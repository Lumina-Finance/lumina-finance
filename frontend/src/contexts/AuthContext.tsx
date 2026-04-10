import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import * as authApi from '@/api/auth';
import type { User, LoginPayload, SignupPayload, AuthResponse } from '@/api/auth';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  /** True while the initial silent refresh is in flight */
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (payload: LoginPayload) => Promise<AuthResponse>;
  signup: (payload: SignupPayload) => Promise<AuthResponse>;
  /** Commit an auth response to state — call after any transition animations */
  setSession: (res: AuthResponse) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_KEY = 'lumina:has_session';

export function AuthProvider({ children }: { children: ReactNode }) {
  // Check once on mount — not reactive to later changes
  const [hadSession] = useState(() => localStorage.getItem(SESSION_KEY) === '1');

  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    loading: hadSession,
  });

  // Attempt refresh only on initial mount if a prior session existed
  useEffect(() => {
    if (!hadSession) return;

    let cancelled = false;

    authApi.refresh()
      .then((res) => {
        if (!cancelled) {
          setState({ user: res.user, accessToken: res.access_token, loading: false });
        }
      })
      .catch(() => {
        localStorage.removeItem(SESSION_KEY);
        if (!cancelled) {
          setState({ user: null, accessToken: null, loading: false });
        }
      });

    return () => { cancelled = true; };
  }, [hadSession]);

  // Call the API and set the session flag, but don't update React state yet.
  // The caller controls when to commit via setSession().
  const login = useCallback(async (payload: LoginPayload) => {
    const res = await authApi.login(payload);
    localStorage.setItem(SESSION_KEY, '1');
    return res;
  }, []);

  const signup = useCallback(async (payload: SignupPayload) => {
    const res = await authApi.signup(payload);
    localStorage.setItem(SESSION_KEY, '1');
    return res;
  }, []);

  const setSession = useCallback((res: AuthResponse) => {
    setState({ user: res.user, accessToken: res.access_token, loading: false });
  }, []);

  const logout = useCallback(async () => {
    if (state.accessToken) {
      await authApi.logout(state.accessToken).catch(() => {});
    }
    localStorage.removeItem(SESSION_KEY);
    setState({ user: null, accessToken: null, loading: false });
  }, [state.accessToken]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, signup, setSession, logout }),
    [state, login, signup, setSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
