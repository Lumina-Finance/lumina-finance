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
  // knowing the backend offered no explanation. `message` cannot answer that: it falls back to a
  // sentence the client invents from the status
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
