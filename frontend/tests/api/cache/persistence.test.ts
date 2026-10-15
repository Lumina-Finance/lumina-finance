/**
 * Guards the saved copy of the query cache that every tab shares: a tab saves only while the
 * session flag names its own user, and a load restores only the copy of the user the flag names
 */
import { QueryClient } from '@tanstack/react-query';
import { persistQueryClientRestore, persistQueryClientSubscribe } from '@tanstack/react-query-persist-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_KEY } from '@/api/auth';
import {
  createQueryCachePersistOptions,
  isRestoredCacheFor,
  QUERY_CACHE_STORAGE_KEY,
  setQueryCacheUser,
} from '@/api/cache/persistence';

const USER_A = 'user-a';
const USER_C = 'user-c';
const OLDER_COPY = JSON.stringify({ clientState: { queries: [{ queryKey: ['accounts'], state: { data: [] } }] } });
const OTHER_TAB_COPY = JSON.stringify({ clientState: { queries: [{ queryKey: ['tags'], state: { data: [] } }] } });

const clients: QueryClient[] = [];
const unsubscribes: (() => void)[] = [];

/** A local storage stand-in backed by a map */
class FakeStorage {
  readonly items = new Map<string, string>();

  getItem(key: string) {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.items.set(key, value);
  }

  removeItem(key: string) {
    this.items.delete(key);
  }
}

/**
 * Stands in for the window the saves use, since vitest runs without a DOM, and starts the
 * persister's timed save as the page does
 *
 * @param stored - What local storage holds as the page loads
 * @param user - The user the tab is signed in as, by default the one the stored flag names
 * @returns The page's local storage and query client, and the restore the page runs on loading
 */
function loadPage(stored: Record<string, string>, { user = stored[SESSION_KEY] ?? null }: { user?: string | null } = {}) {
  const localStorage = new FakeStorage();
  for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage }));

  const client = new QueryClient();
  clients.push(client);
  const options = createQueryCachePersistOptions();
  setQueryCacheUser(user);
  unsubscribes.push(persistQueryClientSubscribe({ ...options, queryClient: client }));

  const restore = () => persistQueryClientRestore({ ...options, queryClient: client });
  return { localStorage, client, restore };
}

// The persister's default wait between timed writes
const TIMED_SAVE_INTERVAL_MS = 1000;

/**
 * Lets the timed save's waiting write run. Its first write on a load goes at once, when a new query
 * is added and before its data is set, so the data reaches storage on the next one
 */
async function runTimedSave() {
  await vi.advanceTimersByTimeAsync(TIMED_SAVE_INTERVAL_MS);
}

beforeEach(() => {
  // The timed save waits a second between writes, so a write it holds stays held for the whole test
  vi.useFakeTimers();
});

afterEach(() => {
  for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
  for (const client of clients.splice(0)) client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('saving the query cache', () => {
  it('saves nothing for this tab\'s user once another user signs in in another tab, until this tab signs in as them', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A });
    page.localStorage.setItem(SESSION_KEY, USER_C);
    page.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, OTHER_TAB_COPY);

    page.client.setQueryData(['accounts'], [{ id: 'first-user-account' }]);
    await runTimedSave();
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe(OTHER_TAB_COPY);

    setQueryCacheUser(USER_C);
    page.client.setQueryData(['accounts'], [{ id: 'next-user-account' }]);
    await runTimedSave();

    expect(page.localStorage.getItem(SESSION_KEY)).toBe(USER_C);
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toContain('next-user-account');
  });

  it('restores a saved copy under the user who saved it', async () => {
    const saving = loadPage({ [SESSION_KEY]: USER_A });
    saving.client.setQueryData(['accounts'], [{ id: 'first-user-account' }]);
    await runTimedSave();

    const reloaded = loadPage(Object.fromEntries(saving.localStorage.items));
    await reloaded.restore();

    expect(reloaded.client.getQueryData(['accounts'])).toEqual([{ id: 'first-user-account' }]);
    expect(isRestoredCacheFor(USER_A)).toBe(true);
  });

  it.each([
    ['another user is signed in', USER_C],
    ['no one is signed in', null],
  ])('restores no copy and removes it when %s', async (_label, flag) => {
    const saving = loadPage({ [SESSION_KEY]: USER_A });
    saving.client.setQueryData(['accounts'], [{ id: 'first-user-account' }]);
    await runTimedSave();
    const stored = Object.fromEntries(saving.localStorage.items);
    expect(stored[QUERY_CACHE_STORAGE_KEY]).toContain('first-user-account');
    if (flag === null) delete stored[SESSION_KEY];
    else stored[SESSION_KEY] = flag;

    const otherLoad = loadPage(stored);
    await otherLoad.restore();

    expect(otherLoad.client.getQueryData(['accounts'])).toBeUndefined();
    expect(otherLoad.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
    expect(isRestoredCacheFor(USER_A)).toBe(false);
  });

  it('stamps a timed save with the user this tab signed in as after loading', async () => {
    const signingIn = loadPage({});
    signingIn.localStorage.setItem(SESSION_KEY, USER_C);
    setQueryCacheUser(USER_C);
    signingIn.client.setQueryData(['accounts'], [{ id: 'next-user-account' }]);
    await runTimedSave();
    expect(signingIn.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toContain('next-user-account');

    const reloaded = loadPage(Object.fromEntries(signingIn.localStorage.items));
    await reloaded.restore();

    expect(reloaded.client.getQueryData(['accounts'])).toEqual([{ id: 'next-user-account' }]);
  });

  it('removes the saved copy instead of saving it once the session has ended', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A, [QUERY_CACHE_STORAGE_KEY]: OLDER_COPY });
    page.localStorage.removeItem(SESSION_KEY);
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe(OLDER_COPY);

    page.client.setQueryData(['accounts'], [{ id: 'first-user-account' }]);
    await runTimedSave();

    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
  });
});
