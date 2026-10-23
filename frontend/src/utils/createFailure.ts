import { ApiError } from '@/api/auth'

type CreatedKind = 'account' | 'transaction'

const GENERIC_CREATE_FAILURE = 'Something went wrong. Please try again.'

/**
 * Reads what a failed create shows the user
 *
 * A create that timed out may still have been saved, since the server can finish after the browser
 * stops waiting, so its message sends the user to check before trying again rather than implying it failed
 */
export function getCreateFailureMessage(error: unknown, kind: CreatedKind) {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `The server took too long to answer. It may have been saved, so check your ${kind}s before trying again.`
  }
  return error instanceof ApiError ? error.message : GENERIC_CREATE_FAILURE
}
