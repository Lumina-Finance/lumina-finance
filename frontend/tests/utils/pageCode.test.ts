/**
 * Guards the recovery from a page whose code a newer deploy removed: one reload, never a loop, and
 * none while the browser is offline, where a reload would only replace the app with an offline page
 */
import { expect, it, vi } from 'vitest';
import { loadPageCode, PAGE_CODE_RELOAD_WINDOW_MS, type PageCodeEnvironment } from '@/utils/pageCode';

const MISSING = new TypeError('Failed to fetch dynamically imported module');

/** An environment whose session storage and reload are stand-ins, since Vitest runs without a DOM */
function createEnvironment(overrides: Partial<PageCodeEnvironment> = {}) {
  const items = new Map<string, string>();
  const reload = vi.fn();
  const environment: PageCodeEnvironment = {
    isOnline: true,
    now: 1_000_000,
    reload,
    storage: {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => { items.set(key, value); },
    },
    ...overrides,
  };
  return { environment, reload };
}

/** Whether a promise has settled, checked after letting every queued callback run */
async function settles(promise: Promise<unknown>) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return settled;
}

it('returns the page code when it loads', async () => {
  const { environment, reload } = createEnvironment();
  await expect(loadPageCode(async () => 'page', environment)).resolves.toBe('page');
  expect(reload).not.toHaveBeenCalled();
});

it('reloads once and holds the page back while it does', async () => {
  const { environment, reload } = createEnvironment();
  const loading = loadPageCode(() => Promise.reject(MISSING), environment);
  expect(await settles(loading)).toBe(false);
  expect(reload).toHaveBeenCalledTimes(1);
});

it('shows the error instead of reloading again when the reload did not help', async () => {
  const { environment, reload } = createEnvironment();
  await settles(loadPageCode(() => Promise.reject(MISSING), environment));
  const retry = { ...environment, now: environment.now + 5_000 };
  await expect(loadPageCode(() => Promise.reject(MISSING), retry)).rejects.toBe(MISSING);
  expect(reload).toHaveBeenCalledTimes(1);
});

it('reloads again for a later deploy once the window has passed', async () => {
  const { environment, reload } = createEnvironment();
  await settles(loadPageCode(() => Promise.reject(MISSING), environment));
  const later = { ...environment, now: environment.now + PAGE_CODE_RELOAD_WINDOW_MS + 1 };
  await settles(loadPageCode(() => Promise.reject(MISSING), later));
  expect(reload).toHaveBeenCalledTimes(2);
});

it('shows the error without reloading while offline', async () => {
  const { environment, reload } = createEnvironment({ isOnline: false });
  await expect(loadPageCode(() => Promise.reject(MISSING), environment)).rejects.toBe(MISSING);
  expect(reload).not.toHaveBeenCalled();
});

it('shows the error without reloading when storage cannot hold the reload marker', async () => {
  const { environment, reload } = createEnvironment({
    storage: { getItem: () => null, setItem: () => { throw new Error('blocked'); } },
  });
  await expect(loadPageCode(() => Promise.reject(MISSING), environment)).rejects.toBe(MISSING);
  expect(reload).not.toHaveBeenCalled();
});

// The browser's own environment once threw on touching blocked storage, before the failure could reach
// the error screen
it('leaves a missing page to the error screen without reloading when the browser blocks storage', async () => {
  const reload = vi.fn();
  const blockedWindow = { location: { reload } };
  Object.defineProperty(blockedWindow, 'sessionStorage', {
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
  vi.stubGlobal('window', blockedWindow);
  vi.stubGlobal('navigator', { onLine: true });
  try {
    await expect(loadPageCode(() => Promise.reject(MISSING))).rejects.toBe(MISSING);
    expect(reload).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
