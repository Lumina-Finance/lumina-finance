/**
 * Guards the error screen's reload onto empty storage: unloading the page for that reload must not
 * save the in-memory query cache, the state suspected of the crash, back into the cleared storage
 */
import { QueryClient } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { SESSION_KEY } from '@/api/auth';
import {
  createQueryCachePersistOptions,
  QUERY_CACHE_STORAGE_KEY,
  saveQueryCacheOnPageHide,
  setQueryCacheUser,
} from '@/api/cache/persistence';
import { clearStoredData } from '@/utils/storedData';

/** A local storage stand-in backed by a map */
function createStorage(items: Map<string, string>) {
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
    clear: () => items.clear(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('leaves only the session flag behind through the reload after clearing stored data', () => {
  // Vitest runs without a DOM, so the window and document the save listens to are stand-ins
  const stored = new Map([[SESSION_KEY, 'user-a']]);
  const page = Object.assign(new EventTarget(), {
    localStorage: createStorage(stored),
    sessionStorage: createStorage(new Map()),
  });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', page);
  vi.stubGlobal('document', document);
  const hide = () => {
    document.visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const client = new QueryClient();
  createQueryCachePersistOptions();
  setQueryCacheUser('user-a');
  saveQueryCacheOnPageHide(client);

  // Hiding the page saves a change until stored data is cleared
  client.setQueryData(['accounts'], [{ id: 'account-before-the-crash' }]);
  hide();
  expect(stored.get(QUERY_CACHE_STORAGE_KEY)).toContain('account-before-the-crash');

  client.setQueryData(['accounts'], [{ id: 'account-from-the-crash' }]);
  clearStoredData();
  hide();
  page.dispatchEvent(new Event('pagehide'));

  expect([...stored]).toEqual([[SESSION_KEY, 'user-a']]);
  client.clear();
});
