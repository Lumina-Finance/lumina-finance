import { SESSION_KEY } from '@/api/auth';
import { stopSavingQueryCache } from '@/api/cache/persistence';

/**
 * Clears everything this browser holds for the app, so a reload starts from nothing
 *
 * The error screens reload through here because a render error can be caused by stored state, and a
 * plain reload would feed that state straight back in and fail the same way
 *
 * The flag saying a session exists is put back afterwards. It holds only the signed-in user's id, none
 * of their data, and without it the next load skips the silent token refresh and drops the user at
 * the login screen, which turns a recoverable crash into signing in again
 */
export function clearStoredData() {
  // The reload that follows hides the page, and a timed save may still be waiting, either of which
  // would otherwise save the in-memory cache, the state suspected of the crash, straight back into
  // the storage just cleared
  stopSavingQueryCache();
  try {
    const hadSession = window.localStorage.getItem(SESSION_KEY);

    window.localStorage.clear();
    window.sessionStorage.clear();

    if (hadSession !== null) {
      window.localStorage.setItem(SESSION_KEY, hadSession);
    }
  } catch {
    // Storage access itself throws where the browser has it disabled. The reload this precedes is
    // the only recovery the user has left, so an unusable store must not take that with it
  }
}
