import { lazy, type ComponentType } from 'react';
import { readStoredValue, writeStoredValue } from '@/utils/browserStorage';

const PAGE_CODE_RELOAD_KEY = 'page-code-reload-at';

/**
 * How long after a reload a second failure counts as the reload not having helped
 *
 * Past it the failure is a later deploy, which gets its own reload. A tab can stay open across many
 * deploys, so the marker cannot simply stay set for the rest of the session
 */
export const PAGE_CODE_RELOAD_WINDOW_MS = 60_000;

export type PageCodeEnvironment = {
  isOnline: boolean;
  now: number;
  reload: () => void;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
};

function readBrowserEnvironment(): PageCodeEnvironment {
  return {
    isOnline: navigator.onLine,
    now: Date.now(),
    reload: () => window.location.reload(),
    // A blocked store reads as no marker and fails to save one, so the failure goes to the error screen
    // rather than reloading with nothing to stop a loop
    storage: {
      getItem: (key) => readStoredValue(key, 'session'),
      setItem: (key, value) => {
        if (!writeStoredValue(key, value, 'session')) throw new Error('Session storage is unavailable');
      },
    },
  };
}

/**
 * Loads a page's code, reloading the app once when it cannot be had
 *
 * Every build names its page files afresh and a deploy removes the old ones, so a tab opened before it
 * asks for files that are gone, and the host answers with the app's HTML instead. The URL is already the
 * page the user asked for, so reloading opens it from the new build. The returned promise then never
 * settles, which keeps the route loader up rather than flashing the error screen as the page goes away
 *
 * Offline is left to the error screen, since a reload there replaces the app with the browser's own
 * offline page. So is a failure shortly after a reload, so a file that stays missing cannot loop
 */
export async function loadPageCode<T>(
  load: () => Promise<T>,
  environment?: PageCodeEnvironment,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    const { isOnline, now, reload, storage } = environment ?? readBrowserEnvironment();
    if (!isOnline) throw error;

    try {
      const reloadedAt = Number(storage.getItem(PAGE_CODE_RELOAD_KEY));
      if (now - reloadedAt >= PAGE_CODE_RELOAD_WINDOW_MS) {
        storage.setItem(PAGE_CODE_RELOAD_KEY, String(now));
        reload();
        return new Promise<T>(() => {});
      }
    } catch {
      // Without the marker a reload could not be told from a loop, so the error screen is the answer
    }

    throw error;
  }
}

/** A lazily loaded page that recovers through `loadPageCode` */
export function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  return lazy(() => loadPageCode(load));
}
