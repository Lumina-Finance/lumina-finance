/**
 * How a setup's final step reads a failure
 *
 * Authenticator, passkey and recovery code setups each finish with one request. Only the server's own
 * refusal means the staged setup is gone, so a dropped request, a timeout or a server error keeps the
 * final button for another try rather than throwing away what the person has done
 */
import { ApiError } from '@/api/auth'

const TOO_MANY_REQUESTS_STATUS = 429

/**
 * Whether the server refused the final step, which it does once the staged setup is missing or has
 * expired, so retrying it can't work
 *
 * Too many requests is left out, since waiting and trying again does work there
 */
export function isSetupRefused(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== TOO_MANY_REQUESTS_STATUS
  )
}
