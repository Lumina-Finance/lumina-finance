import { ApiError, isAnsweredByApp } from '@/api/auth'
import { SERVER_UNREACHABLE_MESSAGE } from '@/api/server'
import { useServerNotice } from '@/api/version'

/**
 * Whether a failure is one the server never answered: a dropped connection, a request that ran out
 * of time or a gateway's own error page
 */
function isUnanswered(error: unknown) {
  return (
    (error instanceof TypeError && error.message === SERVER_UNREACHABLE_MESSAGE) ||
    (error instanceof DOMException && error.name === 'TimeoutError') ||
    (error instanceof ApiError && !isAnsweredByApp(error))
  )
}

/**
 * Whether a failure belongs to a server in maintenance, so a screen or a card words it as one rather
 * than as a bug or an unreachable server. That holds when the server's own answer carries the
 * maintenance marker, and when the maintenance file reports a maintenance for a failure the server
 * never answered. Any other failure keeps its own wording, since a bug shows as a bug during a
 * maintenance too
 */
export function useMaintenanceFailure(error: unknown) {
  const notice = useServerNotice()
  return (error instanceof ApiError && error.isMaintenance) || (notice === 'maintenance' && isUnanswered(error))
}
