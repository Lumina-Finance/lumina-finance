import { useEffect, useState } from 'react';
import { fetchAppVersion } from '@/api/version';

export type ServerReachability = 'checking' | 'reachable' | 'unreachable';

// Long enough to survive a slow connection, short enough that the screen is not still deciding
// what to say once the user has read it
const PROBE_TIMEOUT_MS = 3000;

/**
 * Reports whether the backend answers, so an error screen can tell a broken app from a lost connection
 *
 * The version endpoint is the probe because it needs no session and already exists. A browser
 * reporting itself as offline is believed without a request, since that reading is only ever wrong
 * in the other direction: having a network says nothing about our server being on the far end of it
 *
 * @returns The current verdict, starting at `checking` unless the browser is already known to be offline
 */
export function useServerReachability(): ServerReachability {
  const [reachability, setReachability] = useState<ServerReachability>(() =>
    navigator.onLine ? 'checking' : 'unreachable'
  );

  useEffect(() => {
    if (!navigator.onLine) return;

    let cancelled = false;
    let timer: number | undefined;

    // The request carries no way to abort it, so the timeout races it rather than cancelling it.
    // A probe left running against an unreachable server costs nothing on a screen this is
    const expiry = new Promise<never>((_, reject) => {
      timer = window.setTimeout(reject, PROBE_TIMEOUT_MS);
    });

    Promise.race([fetchAppVersion(), expiry])
      .then(() => {
        if (!cancelled) setReachability('reachable');
      })
      .catch(() => {
        if (!cancelled) setReachability('unreachable');
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return reachability;
}
