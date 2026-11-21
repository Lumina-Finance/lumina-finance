import { ApiError, isAnsweredByApp } from '@/api/auth/errors'
import { SERVER_UNREACHABLE_MESSAGE } from '@/api/server'
import { getServerNotice, type ServerNotice } from '@/api/version/serverState'

/**
 * Whether a failure came from somewhere other than the app: a dropped connection, a request that ran
 * out of time or a gateway's own error page. A render that threw a TypeError of its own is none of these
 */
function isNotFromApp(error: unknown) {
  return (
    (error instanceof TypeError && error.message === SERVER_UNREACHABLE_MESSAGE) ||
    (error instanceof DOMException && error.name === 'TimeoutError') ||
    (error instanceof ApiError && !isAnsweredByApp(error))
  )
}

/**
 * Whether a failure belongs to a server in maintenance, so it reads as one rather than as a bug or an
 * unreachable server. That holds when the server's own answer carries the maintenance marker, and when
 * the maintenance file reports a maintenance for a failure the app never answered. Any other failure
 * keeps its own wording, since a bug shows as a bug during a maintenance too
 *
 * @param notice - What the page tells the user about the server, read now unless a caller subscribed to it
 */
export function isMaintenanceFailure(error: unknown, notice: ServerNotice | null = getServerNotice()) {
  return (error instanceof ApiError && error.isMaintenance) || (notice === 'maintenance' && isNotFromApp(error))
}
