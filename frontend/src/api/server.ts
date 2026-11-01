import { API_BASE } from '@/api/config'

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

  return fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal }).catch((error: unknown) => {
    throw explainRequestFailure(error)
  })
}
