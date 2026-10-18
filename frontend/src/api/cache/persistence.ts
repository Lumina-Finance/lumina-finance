import {
  defaultShouldDehydrateQuery,
  dehydrate,
  type Query,
  type QueryCacheNotifyEvent,
  type QueryClient,
} from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { PersistedClient } from '@tanstack/react-query-persist-client';
import { SESSION_KEY } from '@/api/auth/session';
import { hasUncacheableFxStatus } from '@/api/shared/fxCache';

// The local storage key holding the saved query cache, one copy shared by every tab
export const QUERY_CACHE_STORAGE_KEY = 'lumina:query-cache';

// When this tab loaded the app. Told apart from a restored entry by when its data was fetched, since a
// restored entry keeps the time of the visit that saved it
export const TAB_OPENED_AT = Date.now();

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

// The query cache events that change what a save writes, the ones the persister itself saves on
const SAVED_CACHE_EVENT_TYPES = new Set<QueryCacheNotifyEvent['type']>(['added', 'removed', 'updated']);

// The user this tab is signed in as, from its own sign-in state, and the user the session flag
// named as the page loaded, whose saved copy alone the restore takes
let tabUserId: string | null = null;
let restoredUserId: string | null = null;

// Cache changes since the restore, the count the saved copy reflects, and the count and user the
// timed save's latest serialized copy reflects until it reaches storage
let changeCount = 0;
let savedChangeCount = 0;
let serializedChangeCount = 0;
let serializedUserId: string | null = null;

let isSavingStopped = false;

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
 * @param changes - The change count the copy reflects
 * @param userId - The user whose data the copy holds
 */
function writeSavedCopy(serialize: () => string, changes: number, userId: string | null) {
  if (isSavingStopped) return;
  const sessionUserId = window.localStorage.getItem(SESSION_KEY);
  if (sessionUserId === null) {
    window.localStorage.removeItem(QUERY_CACHE_STORAGE_KEY);
    return;
  }
  if (userId !== sessionUserId) return;
  try {
    window.localStorage.setItem(QUERY_CACHE_STORAGE_KEY, serialize());
    savedChangeCount = changes;
  } catch {
    // Storage is full, so the older copy left behind would be restored as fresh on the next load.
    // Without it that load starts empty and fetches everything
    window.localStorage.removeItem(QUERY_CACHE_STORAGE_KEY);
  }
}

/**
 * Builds the options for restoring the saved query cache and saving it as it changes
 *
 * Built on call rather than at import, since the error screens import this module through clearing
 * stored data, and the frontend tests render markup where there is no window. Called once as the
 * page loads, so the restore takes only the copy of the user the session flag names then
 */
export function createQueryCachePersistOptions() {
  restoredUserId = window.localStorage.getItem(SESSION_KEY);
  return {
    persister: createAsyncStoragePersister({
      // Counted when the persister serializes, since that copy reflects every change so far, and
      // recorded only once it reaches storage, so a timed save an unload cuts short still counts
      // as unsaved. The user is the one at writing, since this tab may have signed in since the
      // restore
      serialize: (persistedClient) => {
        serializedChangeCount = changeCount;
        serializedUserId = tabUserId;
        return JSON.stringify({ ...persistedClient, buster: savedCopyVersion(serializedUserId) });
      },
      storage: {
        getItem: (key: string) => window.localStorage.getItem(key),
        setItem: (_key: string, value: string) =>
          writeSavedCopy(() => value, serializedChangeCount, serializedUserId),
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

/**
 * Saves the query cache at once whenever the page is hidden or unloaded, from the end of the restore
 *
 * The persister writes at most once a second, so a reload inside that second would restore the copy
 * from before the latest fetch, invalidation or sign-out. A restored entry keeps its own fetch time,
 * so it shows without a refetch while still inside its stale time, and the check of what changed on
 * the server has already recorded the newer state, so nothing on the next load would correct it
 *
 * Every tab shares the one saved copy, so a tab writes only when its cache changed since it last
 * wrote, by this save or the persister's. An unchanged tab left in the background would otherwise
 * put its older copy over a newer one another tab saved, and the next load would restore it as fresh
 */
export function saveQueryCacheOnPageHide(queryClient: QueryClient) {
  // The restore has just made the cache and the saved copy the same
  changeCount = 0;
  savedChangeCount = 0;
  queryClient.getQueryCache().subscribe((event) => {
    if (SAVED_CACHE_EVENT_TYPES.has(event.type)) changeCount += 1;
  });

  const save = () => {
    if (changeCount === savedChangeCount) return;
    const changes = changeCount;
    const userId = tabUserId;
    writeSavedCopy(() => {
      const persistedClient: PersistedClient = {
        buster: savedCopyVersion(userId),
        timestamp: Date.now(),
        clientState: dehydrate(queryClient, dehydrateOptions),
      };
      return JSON.stringify(persistedClient);
    }, changes, userId);
  };
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
}

/**
 * Stops every save of the query cache, so a reload after clearing storage starts from nothing
 */
export function stopSavingQueryCache() {
  isSavingStopped = true;
}
