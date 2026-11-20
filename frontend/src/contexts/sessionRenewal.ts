import type { QueryClient } from '@tanstack/react-query'
import type { AuthResponse } from '@/api/auth'
import { dropSavedCopyKey, takeSavedCopyKey } from '@/api/cache/persistence'
import type { AuthState } from '@/contexts/AuthContext'

/**
 * Takes a renewed session into the tab, or signs the tab out when it belongs to someone else
 *
 * Every tab shares the refresh cookie, so after someone else signs in in another tab a renewal here
 * returns their session. The tab signs out rather than show them the earlier user's data or fetch
 * theirs. The session flag and the saved copy are theirs now, so both stay, while the key this tab
 * held for the earlier user goes. A renewal for the tab's own user takes the key it carries
 *
 * @param tabState - The tab's sign-in state as the renewal arrives
 * @param renewed - The session the renewal returned
 * @param queryClient - The tab's query cache, cleared when the tab signs out
 * @param applyState - Replaces the tab's sign-in state
 * @returns Whether the tab took the renewed session
 */
export function takeRenewedSession(
  tabState: AuthState,
  renewed: AuthResponse,
  queryClient: QueryClient,
  applyState: (next: AuthState) => void,
): boolean {
  if (tabState.user !== null && tabState.user.id !== renewed.user.id) {
    applyState({ user: null, accessToken: null, loading: false })
    queryClient.clear()
    dropSavedCopyKey()
    return false
  }
  // A new key number removes the stored copy, since only the old key opens it
  takeSavedCopyKey(renewed)
  applyState({ user: renewed.user, accessToken: renewed.access_token, loading: false })
  return true
}
