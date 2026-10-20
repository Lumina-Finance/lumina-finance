/**
 * Guards the saved copy of the query cache that every tab shares: a tab with nothing new must not put
 * its older copy over another tab's, a tab saves only while the session flag names its own user, a
 * load restores only the copy of the user the flag names, a save that fails must not leave an older
 * copy behind for the next load to restore as fresh, and no save may write a request held while
 * offline along with what it sends, such as both passwords of a password change
 */
import { focusManager, MutationObserver, onlineManager, QueryClient } from '@tanstack/react-query';
import { persistQueryClientRestore, persistQueryClientSubscribe } from '@tanstack/react-query-persist-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_KEY } from '@/api/auth';
import {
  createQueryCachePersistOptions,
  isRestoredCacheFor,
  QUERY_CACHE_STORAGE_KEY,
  saveQueryCacheOnPageHide,
  setQueryCacheUser,
} from '@/api/cache/persistence';
import { changePassword, type ChangePasswordPayload } from '@/api/user';

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  authenticatedFetch: authenticatedFetchMock,
}));

const USER_A = 'user-a';
const USER_C = 'user-c';
const OLDER_COPY = JSON.stringify({ clientState: { queries: [{ queryKey: ['accounts'], state: { data: [] } }] } });
const OTHER_TAB_COPY = JSON.stringify({ clientState: { queries: [{ queryKey: ['tags'], state: { data: [] } }] } });

const clients: QueryClient[] = [];
const unsubscribes: (() => void)[] = [];

/** A local storage stand-in backed by a map, whose writes a test can make fail */
class FakeStorage {
  readonly items = new Map<string, string>();
  failWrites = false;

  getItem(key: string) {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException('The quota has been exceeded', 'QuotaExceededError');
    this.items.set(key, value);
  }

  removeItem(key: string) {
    this.items.delete(key);
  }
}

/**
 * Stands in for the window and document the saves use, since vitest runs without a DOM, and starts
 * saving as the page does once its restore settles
 *
 * @param stored - What local storage holds as the page loads
 * @param user - The user the tab is signed in as, by default the one the stored flag names
 * @param withTimedSave - Whether the persister's own timed save runs too, as in the app
 * @returns The page's local storage and query client, ways to hide and show the page as a tab switch
 * does, and the restore the page runs on loading
 */
function loadPage(
  stored: Record<string, string>,
  { user = stored[SESSION_KEY] ?? null, withTimedSave = false }: { user?: string | null, withTimedSave?: boolean } = {},
) {
  const localStorage = new FakeStorage();
  for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value);
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage }));
  vi.stubGlobal('document', document);

  const client = new QueryClient();
  clients.push(client);
  const options = createQueryCachePersistOptions();
  setQueryCacheUser(user);
  saveQueryCacheOnPageHide(client);
  if (withTimedSave) unsubscribes.push(persistQueryClientSubscribe({ ...options, queryClient: client }));

  const hide = () => {
    document.visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const show = () => {
    document.visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const restore = () => persistQueryClientRestore({ ...options, queryClient: client });
  return { localStorage, client, hide, show, restore };
}

// The persister's default wait between timed writes
const TIMED_SAVE_INTERVAL_MS = 1000;

/** Lets a write the timed save started, a few promise steps away, reach storage */
async function settleTimedSave() {
  await vi.advanceTimersByTimeAsync(0);
}

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
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
  authenticatedFetchMock.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('saving the query cache', () => {
  it('leaves another tab\'s copy alone when this tab has changed nothing since its last save', () => {
    const page = loadPage({ [SESSION_KEY]: USER_A, [QUERY_CACHE_STORAGE_KEY]: OTHER_TAB_COPY });

    page.hide();
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe(OTHER_TAB_COPY);

    page.client.setQueryData(['accounts'], [{ id: 'changed-account' }]);
    page.hide();
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toContain('changed-account');

    page.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, OTHER_TAB_COPY);
    page.hide();
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe(OTHER_TAB_COPY);
  });

  it('counts a timed save as this tab\'s save', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A }, { withTimedSave: true });
    page.client.setQueryData(['accounts'], [{ id: 'changed-account' }]);
    await runTimedSave();
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toContain('changed-account');

    page.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, OTHER_TAB_COPY);
    page.hide();

    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe(OTHER_TAB_COPY);
  });

  it('saves on hiding a change whose timed save is still waiting', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A }, { withTimedSave: true });
    page.client.setQueryData(['accounts'], [{ id: 'first-account' }]);
    await runTimedSave();
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toContain('first-account');
    page.client.setQueryData(['accounts'], [{ id: 'second-account' }]);
    await settleTimedSave();
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).not.toContain('second-account');

    page.hide();

    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toContain('second-account');
  });

  it('saves nothing for this tab\'s user once another user signs in in another tab, until this tab signs in as them', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A }, { withTimedSave: true });
    page.localStorage.setItem(SESSION_KEY, USER_C);
    page.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, OTHER_TAB_COPY);

    page.client.setQueryData(['accounts'], [{ id: 'first-user-account' }]);
    await runTimedSave();
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe(OTHER_TAB_COPY);
    page.hide();
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe(OTHER_TAB_COPY);

    setQueryCacheUser(USER_C);
    page.client.setQueryData(['accounts'], [{ id: 'next-user-account' }]);
    page.hide();

    expect(page.localStorage.getItem(SESSION_KEY)).toBe(USER_C);
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toContain('next-user-account');
  });

  it('restores a saved copy under the user who saved it', async () => {
    const saving = loadPage({ [SESSION_KEY]: USER_A });
    saving.client.setQueryData(['accounts'], [{ id: 'first-user-account' }]);
    saving.hide();

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
    saving.hide();
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
    const signingIn = loadPage({}, { withTimedSave: true });
    signingIn.localStorage.setItem(SESSION_KEY, USER_C);
    setQueryCacheUser(USER_C);
    signingIn.client.setQueryData(['accounts'], [{ id: 'next-user-account' }]);
    await runTimedSave();
    expect(signingIn.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toContain('next-user-account');

    const reloaded = loadPage(Object.fromEntries(signingIn.localStorage.items));
    await reloaded.restore();

    expect(reloaded.client.getQueryData(['accounts'])).toEqual([{ id: 'next-user-account' }]);
  });

  it('removes the saved copy instead of saving it once the session has ended', () => {
    const page = loadPage({ [SESSION_KEY]: USER_A, [QUERY_CACHE_STORAGE_KEY]: OLDER_COPY });
    page.client.setQueryData(['accounts'], [{ id: 'first-user-account' }]);
    page.localStorage.removeItem(SESSION_KEY);
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe(OLDER_COPY);

    page.hide();

    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
  });

  it('removes the older saved copy when saving the newer one fails', () => {
    const page = loadPage({ [SESSION_KEY]: USER_A, [QUERY_CACHE_STORAGE_KEY]: OLDER_COPY });
    page.client.setQueryData(['accounts'], [{ id: 'first-user-account' }]);
    page.localStorage.failWrites = true;
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBe(OLDER_COPY);

    page.hide();

    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
    expect(page.localStorage.getItem(SESSION_KEY)).toBe(USER_A);
  });

  it('keeps query data but not a password change held while offline, and sends the change once back online', async () => {
    const page = loadPage({ [SESSION_KEY]: USER_A }, { withTimedSave: true });
    // Mounted as the app's provider mounts it, since only a mounted client sends held requests once
    // the connection returns
    page.client.mount();
    unsubscribes.push(() => page.client.unmount());
    authenticatedFetchMock.mockResolvedValue(undefined);
    page.client.setQueryData(['accounts'], [{ id: 'account-kept' }]);

    onlineManager.setOnline(false);
    const payload: ChangePasswordPayload = {
      current_password: 'current-secret-123',
      new_password: 'new-secret-456',
      code: '482915',
    };
    const passwordChange = new MutationObserver(page.client, { mutationFn: changePassword });
    void passwordChange.mutate(payload).catch(() => {});
    expect(passwordChange.getCurrentResult().isPaused).toBe(true);

    const expectNoHeldChangeStored = () => {
      const stored = page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY) ?? '';
      expect(JSON.parse(stored).clientState.mutations).toEqual([]);
      for (const secret of Object.values(payload)) expect(stored).not.toContain(secret);
    };

    // The timed save and the save on hiding the page each write the copy
    await runTimedSave();
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toContain('account-kept');
    expectNoHeldChangeStored();

    page.client.setQueryData(['tags'], [{ id: 'tag-kept' }]);
    page.hide();
    expect(page.localStorage.getItem(QUERY_CACHE_STORAGE_KEY)).toContain('tag-kept');
    expectNoHeldChangeStored();

    // A held request also waits while the page is hidden, so it goes once the user is back on it
    page.show();
    onlineManager.setOnline(true);
    await vi.waitFor(() => expect(passwordChange.getCurrentResult().isSuccess).toBe(true));
    expect(authenticatedFetchMock).toHaveBeenCalledExactlyOnceWith('/auth/password', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  });
});
