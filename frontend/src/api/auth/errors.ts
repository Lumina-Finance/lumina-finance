export const REFRESH_ALREADY_ROTATED_STATUS = 409;
export const REFRESH_ALREADY_ROTATED_DETAIL = 'Refresh token was already rotated';

interface ApiErrorOptions {
  attemptsRemaining?: number;
  detail?: string;
}

export class ApiError extends Error {
  status: number;

  /** Step-up attempts left before the shared lockout signs the user out, when the response reports it */
  attemptsRemaining?: number;

  // Set only where the response body carried a `detail`, so an empty one is the app's own way of
  // knowing the backend offered no explanation. `message` cannot answer that: it falls back to the
  // friendly sentence the client shows when the server said nothing
  /** The backend's own explanation of the failure, where the response carried one */
  detail?: string;

  constructor(message: string, status: number, options: ApiErrorOptions = {}) {
    super(message);
    // Without this the class inherits the plain Error name, so a copied bug report cannot tell a
    // request the server refused from a render that threw
    this.name = 'ApiError';
    this.status = status;
    this.attemptsRemaining = options.attemptsRemaining;
    this.detail = options.detail;
  }
}

/**
 * Returns whether an auth error represents a stale refresh rotation response
 */
export function isRefreshAlreadyRotatedError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === REFRESH_ALREADY_ROTATED_STATUS &&
    error.message === REFRESH_ALREADY_ROTATED_DETAIL
  );
}

/** Why restoring a session on page load failed */
export type SessionRestoreFailure = 'rejected' | 'rotated' | 'unavailable';

/**
 * Reads a failed session restore as the server refusing the session, a refresh that lost a rotation
 * race, or a failure that says nothing about the session, such as a gateway error or a dropped request
 *
 * The refresh route refuses a session only with 401, which also clears its cookie, so nothing else
 * may sign the user out
 */
export function getSessionRestoreFailure(error: unknown): SessionRestoreFailure {
  if (error instanceof ApiError && error.status === 401) return 'rejected';
  if (isRefreshAlreadyRotatedError(error)) return 'rotated';
  return 'unavailable';
}

// What a failed request shows when the server sent no explanation of its own, such as a 500 with an
// empty body or a gateway's page. The status stays on the error for the copied report
export const NO_EXPLANATION_MESSAGE = 'Oops, something went wrong. Please try again.';

/**
 * Builds the error a failed response stands for from its status and its parsed body, if any
 *
 * A sentence the server sent is the message. Anything else, including no body at all, gets the
 * friendly sentence, since a status code is not something a user can act on
 */
export function buildApiError(status: number, body: unknown, options: Omit<ApiErrorOptions, 'detail'> = {}): ApiError {
  const detail = typeof body === 'object' && body !== null ? (body as { detail?: unknown }).detail : undefined;
  if (typeof detail === 'string' && detail.trim()) return new ApiError(detail, status, { ...options, detail });

  return new ApiError(NO_EXPLANATION_MESSAGE, status, options);
}
