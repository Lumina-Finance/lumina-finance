/**
 * How a setup's final step reads a failure
 *
 * Authenticator, passkey and recovery code setups each finish with one request. Only the server's own
 * refusal means the staged setup is gone, so a dropped request, a timeout or a server error keeps the
 * final button for another try rather than throwing away what the person has done
 */
import { ApiError, MAINTENANCE_MESSAGE } from '@/api/auth'
import { SERVER_UNREACHABLE_MESSAGE } from '@/api/server'
import { isMaintenanceFailure } from '@/api/version'

const TOO_MANY_REQUESTS_STATUS = 429

/**
 * Whether the server refused the final step, which it does once the staged setup is missing or has
 * expired, so retrying it can't work
 *
 * Too many requests is left out, since waiting and trying again does work there
 */
export function isSetupRefused(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== TOO_MANY_REQUESTS_STATUS
  )
}

/**
 * What a final step says when it failed for another try: that the server is in maintenance during
 * one, and otherwise that it couldn't be reached
 */
export function getSetupRetryMessage(error: unknown): string {
  return isMaintenanceFailure(error) ? MAINTENANCE_MESSAGE : SERVER_UNREACHABLE_MESSAGE
}
