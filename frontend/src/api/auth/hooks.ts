import { useQuery } from '@tanstack/react-query';
import { authKeys } from '@/api/cache/queryKeys';
import { fetchRegistrationStatus } from '@/api/auth/requests';

// Never fresh, so every visit to the login page asks the server again rather than trusting the
// persisted cache
const REGISTRATION_STATUS_STALE_MS = 0;

/**
 * Reads whether the login page may offer sign-up
 *
 * The query cache persists across visits, and the answer follows server configuration, so it is
 * always refetched on mount. Callers decide on `isFetchedAfterMount`, since a remembered answer
 * would offer sign-up after registration closed, or hide it after registration reopened
 */
export function useRegistrationStatus() {
  return useQuery({
    queryKey: authKeys.registration(),
    queryFn: ({ signal }) => fetchRegistrationStatus(signal),
    staleTime: REGISTRATION_STATUS_STALE_MS,
  });
}
