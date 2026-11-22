import { ApiError } from '@/api/auth'

/** Said when a download fails with a server fault or no answer, since a status such as "Internal Server Error" never says the file wasn't saved */
export const DOWNLOAD_FAILED_MESSAGE = 'Oops, something went wrong and nothing was downloaded. Please try again.'

// Said when the session is gone, whatever token detail the server gave, since only signing in again helps
const SESSION_EXPIRED_REASON = 'your session has expired. Please sign in again.'

// What a refusal that arrives with no explanation means, as a proxy in front of the server sends it.
// The server itself always explains its refusals, so only these statuses have a known cause to name
const SHARED_REASONS_BY_STATUS: Record<number, string> = {
  403: "you don't have permission to export.",
  408: 'the request took too long. Please try again.',
  429: 'too many requests were sent. Please wait a moment and try again.',
}

// Said for any other refusal with no explanation, since a 4xx always means the server saw the request
const REFUSED_REASON = 'the request was refused. Please refresh the page and try again.'

/**
 * Says in words why a download failed, always making clear that nothing was saved
 *
 * A refusal the server explained gives its reason after saying nothing was downloaded, and so does one
 * naming refused fields, in the sentence built from them. A refusal with no explanation gives the
 * reason its status stands for, or says the request was refused. Only a server fault or a lost
 * connection gets the plain message, and it is never joined to the "Nothing was downloaded" prefix
 *
 * @param error - What the download threw
 * @param reasonsByStatus - Reasons only this download can give for a status that arrives with no explanation, such as what its 404 means
 */
export function getDownloadFailureMessage(error: unknown, reasonsByStatus: Record<number, string> = {}): string {
  if (!(error instanceof ApiError) || error.status >= 500) return DOWNLOAD_FAILED_MESSAGE
  const message =
    error.status === 401
      ? SESSION_EXPIRED_REASON
      : (error.detail ??
        (error.fieldErrors
          ? error.message.replace(/^Oops, /, '')
          : (reasonsByStatus[error.status] ?? SHARED_REASONS_BY_STATUS[error.status] ?? REFUSED_REASON)))
  const reason = /^[A-Z][a-z]/.test(message) ? message.charAt(0).toLowerCase() + message.slice(1) : message
  return `Nothing was downloaded: ${reason}`
}
