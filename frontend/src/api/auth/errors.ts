export const REFRESH_ALREADY_ROTATED_STATUS = 409;
export const REFRESH_ALREADY_ROTATED_DETAIL = 'Refresh token was already rotated';

export class ApiError extends Error {
  status: number;

  /** Step-up attempts left before the shared lockout signs the user out, when the response reports it */
  attemptsRemaining?: number;

  constructor(message: string, status: number, attemptsRemaining?: number) {
    super(message);
    this.status = status;
    this.attemptsRemaining = attemptsRemaining;
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
