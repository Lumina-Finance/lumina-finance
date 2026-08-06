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
          maxAge: SIX_MONTHS_MS,
          dehydrateOptions: { shouldDehydrateQuery },
        }}
      >
        <App />
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
