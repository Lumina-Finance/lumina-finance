import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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

// Module-scoped so concurrent callers share a single /auth/refresh request.
// The refresh token is rotated on use, so a second parallel call would race
// the first, look up a now-deleted jti, and 401 — wiping the just-issued
// cookie on the way out.
let pendingSessionRestore: Promise<AuthResponse> | null = null;

function restoreSession(): Promise<AuthResponse> {
  if (!pendingSessionRestore) {
    pendingSessionRestore = authApi.refresh().finally(() => { pendingSessionRestore = null; });
  }
  return pendingSessionRestore;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Check once on mount — not reactive to later changes
  const [hadSession] = useState(() => localStorage.getItem(SESSION_KEY) === '1');
  const queryClient = useQueryClient();

  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    loading: hadSession,
  });

  // Attempt refresh only on initial mount if a prior session existed
  useEffect(() => {
    if (!hadSession) return;

    let cancelled = false;

    restoreSession()
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
    // Wipe every cached query so the next user can't see the previous user's
    // data (accounts, transactions, etc.). The persister is subscribed to the
    // client, so clearing in-memory also flushes the localStorage copy.
    queryClient.clear();
  }, [state.accessToken, queryClient]);

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
