import { createContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as authApi from '@/api/auth';
import type {
  AuthResponse,
  LoginPayload,
  LoginResult,
  MfaVerifyPayload,
  SignupPayload,
  User,
} from '@/api/auth';
import { registerAuthBindings } from '@/api/client';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  /** True while the initial silent refresh is in flight */
  loading: boolean;
}

export interface AuthContextValue extends AuthState {
  login: (payload: LoginPayload) => Promise<LoginResult>;
  /** Exchange a second-factor challenge and code for a session */
  verifyMfa: (payload: MfaVerifyPayload) => Promise<AuthResponse>;
  signup: (payload: SignupPayload) => Promise<AuthResponse>;
  /** Commit an auth response to state — call after any transition animations */
  setSession: (res: AuthResponse) => void;
  /** Make an access token usable by requests without committing a session, for the signup 2FA step */
  primeAccessToken: (token: string) => void;
  /** Replace just the user profile — used after /me updates to keep the context fresh */
  setUser: (user: User) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_KEY = 'lumina:has_session';
const RELOAD_SESSION_RESTORE_DELAY_MS = 750;

/**
 * Returns whether this page load came from the browser reload action
 */
function isBrowserReload(): boolean {
  if (typeof performance === 'undefined') return false;

  const [navigationEntry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  return navigationEntry?.type === 'reload';
}

/**
 * Returns the delay before initial restore so rapid reloads do not start refresh rotation
 */
function getSessionRestoreDelayMs(): number {
  return isBrowserReload() ? RELOAD_SESSION_RESTORE_DELAY_MS : 0;
}

// Module-scoped so concurrent callers share a single /auth/refresh request
// The refresh token is rotated on use, so a second parallel call would race
// the first, look up a now-deleted jti, and 401 — wiping the just-issued
// cookie on the way out
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

  // Ref mirrors state so the auth bindings' getAccessToken closure always
  // reads the latest token without re-registering bindings on every change
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Child effects run before this provider's ref-sync effect, so any consumer that
  // fetches on the same render a new token arrives would still read the stale ref
  // Full state replacements therefore update the ref synchronously, like primeAccessToken
  const applyState = useCallback((next: AuthState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Wire authenticatedFetch to our session lifecycle once on mount
  useEffect(() => {
    registerAuthBindings({
      getAccessToken: () => stateRef.current.accessToken,
      onSessionRefreshed: (res) => {
        applyState({ user: res.user, accessToken: res.access_token, loading: false });
      },
      onSessionLost: () => {
        localStorage.removeItem(SESSION_KEY);
        applyState({ user: null, accessToken: null, loading: false });
        queryClient.clear();
      },
    });
  }, [queryClient, applyState]);

  // Attempt refresh only on initial mount if a prior session existed
  useEffect(() => {
    if (!hadSession) return;

    let cancelled = false;
    let restoreTimer: ReturnType<typeof setTimeout> | null = null;

    const runRestore = () => {
      restoreSession()
        .then((res) => {
          if (!cancelled) {
            applyState({ user: res.user, accessToken: res.access_token, loading: false });
          }
        })
        .catch((error) => {
          if (authApi.isRefreshAlreadyRotatedError(error)) {
            if (!cancelled) {
              setState((prev) => ({ ...prev, loading: false }));
            }
            return;
          }

          localStorage.removeItem(SESSION_KEY);
          queryClient.clear();
          if (!cancelled) {
            applyState({ user: null, accessToken: null, loading: false });
          }
        });
    };

    const restoreDelayMs = getSessionRestoreDelayMs();
    if (restoreDelayMs > 0) {
      restoreTimer = setTimeout(runRestore, restoreDelayMs);
    } else {
      runRestore();
    }

    return () => {
      cancelled = true;
      if (restoreTimer) clearTimeout(restoreTimer);
    };
  }, [hadSession, queryClient, applyState]);

  // Call the API and set the session flag, but don't update React state yet
  // The caller controls when to commit via setSession()
  const login = useCallback(async (payload: LoginPayload): Promise<LoginResult> => {
    const res = await authApi.login(payload);

    // A second-factor challenge is not a session yet, so hold off marking one until verify
    if (authApi.isMfaRequired(res)) {
      return res;
    }

    queryClient.clear();
    localStorage.setItem(SESSION_KEY, '1');
    return res;
  }, [queryClient]);

  const verifyMfa = useCallback(async (payload: MfaVerifyPayload) => {
    const res = await authApi.verifyMfa(payload);
    queryClient.clear();
    localStorage.setItem(SESSION_KEY, '1');
    return res;
  }, [queryClient]);

  const signup = useCallback(async (payload: SignupPayload) => {
    const res = await authApi.signup(payload);
    queryClient.clear();
    localStorage.setItem(SESSION_KEY, '1');
    return res;
  }, [queryClient]);

  const setSession = useCallback((res: AuthResponse) => {
    // Persist the session flag and drop any prior user's cache at the single commit point, so a passkey
    // sign-in and the passkey second factor behave like the password and code paths. Those paths reach
    // this commit without going through login/verifyMfa, so without this a reload finds no flag, skips
    // the silent refresh, and signs the user out despite a valid refresh cookie
    localStorage.setItem(SESSION_KEY, '1');
    queryClient.clear();
    applyState({ user: res.user, accessToken: res.access_token, loading: false });
  }, [queryClient, applyState]);

  const primeAccessToken = useCallback((token: string) => {
    // Make the token usable by authenticated requests without setting `user`, so the signup
    // 2FA step can call the API while the auth page stays mounted instead of redirecting home
    // The ref is updated synchronously so getAccessToken sees the token before the effect runs
    stateRef.current = { ...stateRef.current, accessToken: token };
    setState((prev) => ({ ...prev, accessToken: token }));
  }, []);

  const setUser = useCallback((user: User) => {
    setState((prev) => ({ ...prev, user }));
  }, []);

  const logout = useCallback(async () => {
    if (state.accessToken) {
      await authApi.logout(state.accessToken).catch(() => {});
    }
    localStorage.removeItem(SESSION_KEY);
    applyState({ user: null, accessToken: null, loading: false });
    // Wipe every cached query so the next user can't see the previous user's
    // data (accounts, transactions, etc.). The persister is subscribed to the
    // client, so clearing in-memory also flushes the localStorage copy
    queryClient.clear();
  }, [state.accessToken, queryClient, applyState]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, verifyMfa, signup, setSession, primeAccessToken, setUser, logout }),
    [state, login, verifyMfa, signup, setSession, primeAccessToken, setUser, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { AuthContext };
