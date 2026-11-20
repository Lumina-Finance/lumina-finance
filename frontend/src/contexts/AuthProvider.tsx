import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { IsRestoringProvider, useQueryClient } from '@tanstack/react-query'
import * as authApi from '@/api/auth'
import type {
  AuthResponse,
  ConfirmSignupPayload,
  LoginPayload,
  LoginResult,
  MfaVerifyPayload,
  SignupPayload,
  User,
} from '@/api/auth'
import { registerAuthBindings } from '@/api/client'
import {
  discardSavedCopy,
  removeUnreadableSavedCopy,
  restoreSavedQueryCache,
  setQueryCacheUser,
  startSavingQueryCache,
  takeSavedCopyKey,
} from '@/api/cache/persistence'
import { clearUserScopedCache } from '@/api/cache/session'
import { AuthContext, type AuthContextValue, type AuthState } from '@/contexts/AuthContext'
import { takeRenewedSession } from '@/contexts/sessionRenewal'
import { readStoredValue, removeStoredValue, writeStoredValue } from '@/utils/browserStorage'

const RELOAD_SESSION_RESTORE_DELAY_MS = 750

/**
 * Returns whether this page load came from the browser reload action
 */
function isBrowserReload(): boolean {
  if (typeof performance === 'undefined') return false

  const [navigationEntry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
  return navigationEntry?.type === 'reload'
}

/**
 * Returns the delay before initial restore so rapid reloads do not start refresh rotation
 */
function getSessionRestoreDelayMs(): number {
  return isBrowserReload() ? RELOAD_SESSION_RESTORE_DELAY_MS : 0
}

/**
 * Provides the authenticated session to the component tree: the current user, access token, and the
 * actions that start, refresh, or end it
 *
 * On mount, if a prior session flag is set, it silently attempts a token refresh to restore the
 * session, waiting briefly first after a browser reload so a refresh already in flight from before the
 * reload can finish rather than racing a second rotation. Only the server refusing the session ends it,
 * and a refresh that lost a rotation race keeps the flag and stops loading as before. A restore that
 * fails for any other reason keeps the session flag and reports the error, so the app can offer a
 * reload rather than the login page. Starting a new session clears user queries
 * and mutations while retaining public currency metadata. Ending a session clears both caches fully
 *
 * The saved query cache is restored here, once the renewal has answered with the key that opens it,
 * and every query waits until that settles, whether it restored a copy, found none, or had no session
 * to restore for. Saving starts then too, so a save can't put an empty cache over the stored copy
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  // Check once on mount — not reactive to later changes. A browser that blocks storage reads as one
  // holding no session, so it opens at the login page rather than failing to start
  const [hadSession] = useState(() => readStoredValue(authApi.SESSION_KEY) !== null)
  const queryClient = useQueryClient()

  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    loading: hadSession,
  })

  // Whether the saved query cache is still to be restored. Every query waits while it is. Without a
  // session there is nothing to restore, so nothing waits
  const [isRestoring, setIsRestoring] = useState(hadSession)
  const isSavingStartedRef = useRef(false)
  const startSaving = useCallback(() => {
    if (isSavingStartedRef.current) return
    isSavingStartedRef.current = true
    startSavingQueryCache(queryClient)
  }, [queryClient])
  const settleRestore = useCallback(() => {
    startSaving()
    setIsRestoring(false)
  }, [startSaving])

  // Ref mirrors state so the auth bindings' getAccessToken closure always
  // reads the latest token without re-registering bindings on every change
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // When the access token stops being accepted, fixed when it arrives. Kept beside the state rather
  // than in it, since the ref-sync effect above would otherwise replace it with a stale copy
  const accessTokenExpiresAtRef = useRef<number | null>(null)
  const noteAccessToken = useCallback((token: string | null) => {
    if (token === stateRef.current.accessToken) return
    accessTokenExpiresAtRef.current = token ? authApi.getAccessTokenExpiresAt(token, Date.now()) : null
  }, [])

  // Child effects run before this provider's ref-sync effect, so any consumer that
  // fetches on the same render a new token arrives would still read the stale ref
  // Full state replacements therefore update the ref synchronously, like primeAccessToken. The saved
  // query cache learns the user here too, since only a tab signed in as the user the session flag
  // names may save
  const applyState = useCallback(
    (next: AuthState) => {
      noteAccessToken(next.accessToken)
      setQueryCacheUser(next.user?.id ?? null)
      stateRef.current = next
      setState(next)
    },
    [noteAccessToken],
  )

  // Wire authenticatedFetch to our session lifecycle once on mount
  useEffect(() => {
    registerAuthBindings({
      getAccessToken: () => stateRef.current.accessToken,
      getAccessTokenExpiresAt: () => accessTokenExpiresAtRef.current,
      onSessionRefreshed: (res) => takeRenewedSession(stateRef.current, res, queryClient, applyState),
      onSessionLost: () => {
        removeStoredValue(authApi.SESSION_KEY)
        discardSavedCopy()
        applyState({ user: null, accessToken: null, loading: false })
        queryClient.clear()
      },
    })
  }, [queryClient, applyState])

  // Attempt refresh only on initial mount if a prior session existed
  useEffect(() => {
    if (!hadSession) {
      // A copy stored with no session to open it, such as one left by a version that kept no flag, is
      // of no use to anyone, so it goes rather than waiting to be tried
      discardSavedCopy()
      startSaving()
      return
    }

    // A copy in the form earlier versions wrote needs no key to be recognised, so a load whose renewal
    // is refused or can't be answered clears it too
    removeUnreadableSavedCopy()

    let cancelled = false
    let restoreTimer: ReturnType<typeof setTimeout> | null = null

    const runRestore = () => {
      authApi
        .restoreSession()
        .then(async (res) => {
          if (cancelled) return
          takeSavedCopyKey(res)
          await restoreSavedQueryCache(queryClient, res.user.id)
          if (cancelled) return
          writeStoredValue(authApi.SESSION_KEY, res.user.id)
          applyState({ user: res.user, accessToken: res.access_token, loading: false })
          settleRestore()
        })
        .catch((error) => {
          const failure = authApi.getSessionRestoreFailure(error)
          if (failure === 'rotated') {
            if (!cancelled) {
              setState((prev) => ({ ...prev, loading: false }))
              settleRestore()
            }
            return
          }

          // A server error or a dropped request says nothing about the session, so the flag and the
          // cache stay for a reload to restore it once the server answers
          if (failure === 'unavailable') {
            if (!cancelled) {
              applyState({ user: null, accessToken: null, loading: false, sessionRestoreError: error })
              settleRestore()
            }
            return
          }

          removeStoredValue(authApi.SESSION_KEY)
          discardSavedCopy()
          queryClient.clear()
          if (!cancelled) {
            applyState({ user: null, accessToken: null, loading: false })
            settleRestore()
          }
        })
    }

    const restoreDelayMs = getSessionRestoreDelayMs()
    if (restoreDelayMs > 0) {
      restoreTimer = setTimeout(runRestore, restoreDelayMs)
    } else {
      runRestore()
    }

    return () => {
      cancelled = true
      if (restoreTimer) clearTimeout(restoreTimer)
    }
  }, [hadSession, queryClient, applyState, startSaving, settleRestore])

  // Marks a new session in this browser: drops any prior user's cache, sets the session flag and takes
  // the key its saved copy is sealed with. Taking the same key again changes nothing
  const markSession = useCallback(
    (res: AuthResponse) => {
      clearUserScopedCache(queryClient)
      writeStoredValue(authApi.SESSION_KEY, res.user.id)
      takeSavedCopyKey(res)
    },
    [queryClient],
  )

  // Call the API and set the session flag, but don't update React state yet
  // The caller controls when to commit via setSession()
  const login = useCallback(
    async (payload: LoginPayload): Promise<LoginResult> => {
      const res = await authApi.login(payload)

      // A second-factor challenge is not a session yet, so hold off marking one until verify
      if (authApi.isMfaRequired(res)) {
        return res
      }

      markSession(res)
      return res
    },
    [markSession],
  )

  const verifyMfa = useCallback(
    async (payload: MfaVerifyPayload) => {
      const res = await authApi.verifyMfa(payload)
      markSession(res)
      return res
    },
    [markSession],
  )

  const signup = useCallback((payload: SignupPayload) => authApi.signup(payload), [])

  const confirmSignup = useCallback(
    async (payload: ConfirmSignupPayload) => {
      const res = await authApi.confirmSignup(payload)
      markSession(res)
      return res
    },
    [markSession],
  )

  const setSession = useCallback(
    (res: AuthResponse) => {
      // Mark the session at the single commit point, so a passkey sign-in and the passkey second factor
      // behave like the password and code paths. Those paths reach this commit without going through
      // login/verifyMfa, so without this a reload finds no flag, skips the silent refresh, and signs the
      // user out despite a valid refresh cookie
      markSession(res)
      applyState({ user: res.user, accessToken: res.access_token, loading: false })
    },
    [markSession, applyState],
  )

  const primeAccessToken = useCallback(
    (token: string) => {
      // Make the token usable by authenticated requests without setting `user`, so the signup
      // 2FA step can call the API while the auth page stays mounted instead of redirecting home
      // The ref is updated synchronously so getAccessToken sees the token before the effect runs
      noteAccessToken(token)
      stateRef.current = { ...stateRef.current, accessToken: token }
      setState((prev) => ({ ...prev, accessToken: token }))
    },
    [noteAccessToken],
  )

  const setUser = useCallback((user: User) => {
    setState((prev) => ({ ...prev, user }))
  }, [])

  const logout = useCallback(async () => {
    if (state.accessToken) {
      await authApi.logout(state.accessToken).catch(() => {})
    }
    removeStoredValue(authApi.SESSION_KEY)
    // Removes the saved copy at once and forgets the key, so a save still being encrypted finds no
    // session and leaves nothing
    discardSavedCopy()
    applyState({ user: null, accessToken: null, loading: false })
    // Wipe every cached query so the next user can't see the previous user's
    // data (accounts, transactions, etc.)
    queryClient.clear()
  }, [state.accessToken, queryClient, applyState])

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, verifyMfa, signup, confirmSignup, setSession, primeAccessToken, setUser, logout }),
    [state, login, verifyMfa, signup, confirmSignup, setSession, primeAccessToken, setUser, logout],
  )

  return (
    <IsRestoringProvider value={isRestoring}>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    </IsRestoringProvider>
  )
}
