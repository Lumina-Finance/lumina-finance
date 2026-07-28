import { SESSION_KEY } from '@/contexts/AuthContext';

/**
 * Clears everything this browser holds for the app, so a reload starts from nothing
 *
 * The error screens reload through here because a render error can be caused by stored state, and a
 * plain reload would feed that state straight back in and fail the same way
 *
 * The flag saying a session exists is put back afterwards. It carries no data, and without it the
 * next load skips the silent token refresh and drops the user at the login screen, which turns a
 * recoverable crash into signing in again
 */
export function clearStoredData() {
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
