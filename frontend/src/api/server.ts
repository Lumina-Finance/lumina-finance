import { API_BASE } from '@/api/config';

// How long a request to the server may go unanswered before it fails, so a screen waiting on one that
// never answers shows its error state rather than loading forever. Long enough for the slowest
// ordinary page on a slow connection. Requests known to take longer, such as imports, set their own
export const REQUEST_TIMEOUT_MS = 30_000;

// Screens that show a failure's own message show this one as it is, as they do the browser's message
// for a dropped connection
const REQUEST_TIMEOUT_MESSAGE = 'The server took too long to answer. Try again.';

export type ServerRequestInit = RequestInit & {
  /** How long this request may go unanswered, in milliseconds, when it differs from the shared limit */
  timeoutMs?: number;
};

/**
 * Sends a request to the app's server, failing it with a TimeoutError once it has gone unanswered too long
 *
 * The limit covers reading the body as well as the headers, since the signal stays attached until the
 * caller has read it. A caller's own signal still aborts the request with its own reason. The two are
 * joined by hand rather than with AbortSignal.any, which some browsers the build supports lack
 */
export function fetchFromServer(path: string, { timeoutMs = REQUEST_TIMEOUT_MS, signal, ...init }: ServerRequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  setTimeout(() => {
    controller.abort(new DOMException(REQUEST_TIMEOUT_MESSAGE, 'TimeoutError'));
  }, timeoutMs);

  if (signal?.aborted) {
    controller.abort(signal.reason);
  } else {
    signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }

  return fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
}
