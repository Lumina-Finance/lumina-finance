import { GATEWAY_STATUSES, isMaintenanceAnswer } from '@/api/auth/errors'
import { API_BASE } from '@/api/config'
import { checkMaintenanceFile } from '@/api/version/maintenanceFile'
import { reportMaintenance } from '@/api/version/serverState'

// How long a request to the server may go unanswered before it fails, so a screen waiting on one that
// never answers shows its error state rather than loading forever. Long enough for the slowest
// ordinary page on a slow connection. Requests known to take longer, such as imports, set their own
export const REQUEST_TIMEOUT_MS = 30_000

// Screens that show a failure's own message show this one as it is
const REQUEST_TIMEOUT_MESSAGE = 'Oops, the server took too long to answer. Please try again.'

// Shown in place of the browser's own words when a request never got a usable answer, such as a dropped
// connection
export const SERVER_UNREACHABLE_MESSAGE = "Couldn't reach the server. Please try again."

/**
 * Swaps the browser's own words for a request that never got an answer, such as "Failed to fetch", for
 * the friendly sentence, and passes every other failure on untouched
 *
 * The result stays a TypeError, which the screens that check for a dropped connection rely on, and
 * keeps the browser's failure as its cause. Screens that show an error's message as it is get the
 * sentence without checking the failure's kind
 */
export function explainRequestFailure(error: unknown): unknown {
  if (!(error instanceof TypeError)) return error
  return new TypeError(SERVER_UNREACHABLE_MESSAGE, { cause: error })
}

export type ServerRequestInit = RequestInit & {
  /** How long this request may go unanswered, in milliseconds, when it differs from the shared limit */
  timeoutMs?: number
}

/**
 * Sends a request to the app's server, failing it with a TimeoutError once it has gone unanswered too long
 *
 * The limit covers reading the body as well as the headers, since the signal stays attached until the
 * caller has read it. A caller's own signal still aborts the request with its own reason. The two are
 * joined by hand rather than with AbortSignal.any, which some browsers the build supports lack
 */
export function fetchFromServer(
  path: string,
  { timeoutMs = REQUEST_TIMEOUT_MS, signal, ...init }: ServerRequestInit = {},
): Promise<Response> {
  const controller = new AbortController()
  setTimeout(() => {
    controller.abort(new DOMException(REQUEST_TIMEOUT_MESSAGE, 'TimeoutError'))
  }, timeoutMs)

  if (signal?.aborted) {
    controller.abort(signal.reason)
  } else {
    signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }

  return fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal })
    .catch((error: unknown) => {
      if (isUnanswered(error)) void checkMaintenanceFile()
      throw explainRequestFailure(error)
    })
    .then(async (response) => {
      await noteMaintenance(response)
      return response
    })
}

/**
 * Whether a request failed with no answer from the server: a dropped connection, or the limit above.
 * A caller's own abort is not one
 */
function isUnanswered(error: unknown) {
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')
}

// The app itself answers a gateway status with a detail, such as a 502 for a provider it couldn't reach
function hasDetail(body: unknown) {
  if (typeof body !== 'object' || body === null) return false
  const { detail } = body as { detail?: unknown }
  return typeof detail === 'string' && detail.trim() !== ''
}

/**
 * Tells the page whether the server is in maintenance from an answer, for every kind of request
 * alike, so a screen that fails to load and one that restores a session read the same state. An
 * answer the server accepts ends it. Only a gateway's failure status could be a maintenance. A 503
 * whose body carries the maintenance marker is one, read from a copy so the caller still gets the body.
 * Any other gateway failure has the page ask the maintenance file instead, as it does for a request
 * with no answer
 */
async function noteMaintenance(response: Response) {
  if (response.ok) {
    reportMaintenance(false)
    return
  }
  if (!GATEWAY_STATUSES.has(response.status)) return
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null)
  if (isMaintenanceAnswer(response.status, body)) reportMaintenance(true)
  else if (!hasDetail(body)) void checkMaintenanceFile()
}
