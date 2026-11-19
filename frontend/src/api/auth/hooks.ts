import { useQuery } from '@tanstack/react-query'
import { authKeys } from '@/api/cache/queryKeys'
import { checkResetLink, fetchRegistrationStatus } from '@/api/auth/requests'

// Never fresh, so every visit to the login page asks the server again rather than trusting the
// persisted cache
const REGISTRATION_STATUS_STALE_MS = 0

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
  })
}

/**
 * Reads how many linked sign-in providers a reset from this link would remove
 *
 * A dead link is refused again on submit with its own message, so a failed check is not retried
 * and only leaves the warning out. The answer is read once per link, since a link spent by the
 * reset would only be refused, and each refusal counts toward the source address's ban
 */
export function useResetLinkCheck(token: string) {
  return useQuery({
    queryKey: authKeys.resetLink(token),
    queryFn: ({ signal }) => checkResetLink(token, signal),
    enabled: token !== '',
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
