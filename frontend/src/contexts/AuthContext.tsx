import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import * as authApi from '@/api/auth';
import type { User, LoginPayload, SignupPayload } from '@/api/auth';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  /** True while the initial silent refresh is in flight */
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (payload: LoginPayload) => Promise<void>;
  signup: (payload: SignupPayload) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    loading: true,
  });

  // Attempt silent refresh on mount to restore session from httpOnly cookie
  useEffect(() => {
    let cancelled = false;

    authApi.refresh()
      .then((res) => {
        if (!cancelled) {
          setState({ user: res.user, accessToken: res.access_token, loading: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ user: null, accessToken: null, loading: false });
        }
      });

    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (payload: LoginPayload) => {
    const res = await authApi.login(payload);
    setState({ user: res.user, accessToken: res.access_token, loading: false });
  }, []);

  const signup = useCallback(async (payload: SignupPayload) => {
    const res = await authApi.signup(payload);
    setState({ user: res.user, accessToken: res.access_token, loading: false });
  }, []);

  const logout = useCallback(async () => {
    if (state.accessToken) {
      await authApi.logout(state.accessToken).catch(() => {});
    }
    setState({ user: null, accessToken: null, loading: false });
  }, [state.accessToken]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, signup, logout }),
    [state, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
