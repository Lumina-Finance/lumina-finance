import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { defaultShouldDehydrateQuery, QueryClient, type Query } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
// Each import picks the narrowest build covering what the app renders. DM Sans varies by weight
// only, giving up the letterform adjustment the third-party stylesheet carried, and italic ships
// for it alone since no other family is ever set in italic. DM Mono ships the one weight in use
import '@fontsource-variable/dm-sans/wght.css'
import '@fontsource-variable/dm-sans/wght-italic.css'
import '@fontsource-variable/cormorant-garamond/wght.css'
import '@fontsource-variable/space-grotesk/wght.css'
import '@fontsource/dm-mono/400.css'
import '@/styles/tailwind.css'
import App from '@/App.tsx'
import ErrorBoundary from '@/components/errors/Boundary'
import { hasUncacheableFxStatus } from '@/api/shared/fxCache'

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;

// Throws away every persisted entry whenever a stored response changes shape, so the app cannot
// restore a payload whose fields the code then looks for and fails to find. Persisted data
// outlives a deploy by up to six months and a fresh one is not refetched while it is still
// within its stale window, so without this the first render after such a change draws a card from
// fields that are no longer there. Bump it on any shape change. Version 1 is the account spending
// breakdown carrying a total per card in place of one shared figure. Version 2 adds the caller's
// write capability to every account response
const PERSISTED_CACHE_SHAPE = '2';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 60 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const persister = createAsyncStoragePersister({
  storage: window.localStorage,
  key: 'lumina:query-cache',
});

/**
 * Persists successful query data while leaving failed FX responses out of local storage
 */
function shouldDehydrateQuery(query: Query) {
  return defaultShouldDehydrateQuery(query) && !hasUncacheableFxStatus(query.state.data);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Above the providers, so a provider that throws while starting up is caught too. React logs
        every caught error to the console on its own, so nothing is wired up for reporting here */}
    <ErrorBoundary variant="screen">
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          buster: PERSISTED_CACHE_SHAPE,
          maxAge: SIX_MONTHS_MS,
          dehydrateOptions: { shouldDehydrateQuery },
        }}
      >
        <App />
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
