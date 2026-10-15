import { defaultShouldDehydrateQuery, type Query } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { SESSION_KEY } from '@/api/auth/session';
import { hasUncacheableFxStatus } from '@/api/shared/fxCache';

// The local storage key holding the saved query cache, one copy shared by every tab
export const QUERY_CACHE_STORAGE_KEY = 'lumina:query-cache';

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;

// Throws away every persisted entry whenever a stored response changes shape, so the app cannot
// restore a payload whose fields the code then looks for and fails to find. Persisted data
// outlives a deploy by up to six months and a fresh one is not refetched while it is still
// within its stale window, so without this the first render after such a change draws a card from
// fields that are no longer there. Bump it on any shape change. Version 1 is the account spending
// breakdown carrying a total per card in place of one shared figure. Version 2 adds the caller's
// write capability to every account response
const PERSISTED_CACHE_SHAPE = '2';

/**
 * Persists successful query data while leaving failed FX responses out of local storage
 */
function shouldDehydrateQuery(query: Query) {
  return defaultShouldDehydrateQuery(query) && !hasUncacheableFxStatus(query.state.data);
}

const dehydrateOptions = { shouldDehydrateQuery };

// The user this tab is signed in as, from its own sign-in state, and the user the session flag
// named as the page loaded, whose saved copy alone the restore takes
let tabUserId: string | null = null;
let restoredUserId: string | null = null;

// The user the persister's latest serialized copy holds, until it reaches storage
let serializedUserId: string | null = null;

/**
 * The version a saved copy carries: its shape and the user whose data it holds
 *
 * The restore throws away a copy whose version differs from the one it expects, so a load never
 * shows another user's data, and a signed-out load, or one under a session flag from before the
 * flag held a user, takes none
 */
function savedCopyVersion(userId: string | null) {
  return `${PERSISTED_CACHE_SHAPE}:${userId ?? ''}`;
}

/**
 * Writes this tab's copy of the cache to storage, or removes the stored copy once signed out
 *
 * The copy is written only while the session flag names the user this tab is signed in as. The
 * flag is gone once the session ends, and names someone else once another person signs in in
 * another tab, so a tab still holding the earlier user's data can't save it where the next load,
 * which belongs to that other person, would restore it
 *
 * @param serialize - Produces the copy, only called when it will be written
 * @param userId - The user whose data the copy holds
 */
function writeSavedCopy(serialize: () => string, userId: string | null) {
  const sessionUserId = window.localStorage.getItem(SESSION_KEY);
  if (sessionUserId === null) {
    window.localStorage.removeItem(QUERY_CACHE_STORAGE_KEY);
    return;
  }
  if (userId !== sessionUserId) return;
  window.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, serialize());
}

/**
 * Builds the options for restoring the saved query cache and saving it as it changes
 *
 * Built on call rather than at import, since the frontend tests render markup where there is no
 * window. Called once as the page loads, so the restore takes only the copy of the user the session
 * flag names then
 */
export function createQueryCachePersistOptions() {
  restoredUserId = window.localStorage.getItem(SESSION_KEY);
  return {
    persister: createAsyncStoragePersister({
      // The user is the one at writing, since this tab may have signed in since the restore
      serialize: (persistedClient) => {
        serializedUserId = tabUserId;
        return JSON.stringify({ ...persistedClient, buster: savedCopyVersion(serializedUserId) });
      },
      storage: {
        getItem: (key: string) => window.localStorage.getItem(key),
        setItem: (_key: string, value: string) => writeSavedCopy(() => value, serializedUserId),
        removeItem: (key: string) => window.localStorage.removeItem(key),
      },
      key: QUERY_CACHE_STORAGE_KEY,
    }),
    buster: savedCopyVersion(restoredUserId),
    maxAge: SIX_MONTHS_MS,
    dehydrateOptions,
  };
}

/**
 * Whether the restored cache holds this user's data, so a session restored for anyone else, such
 * as one signed in elsewhere since the page loaded, starts without it
 */
export function isRestoredCacheFor(userId: string) {
  return restoredUserId === userId;
}

/**
 * Records the user this tab is signed in as, or null once it signs out, which alone lets it save
 */
export function setQueryCacheUser(userId: string | null) {
  tabUserId = userId;
}
