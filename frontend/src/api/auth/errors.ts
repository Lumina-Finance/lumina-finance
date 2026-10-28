import { formatList } from '@/utils/formatList';

export const REFRESH_ALREADY_ROTATED_STATUS = 409;
export const REFRESH_ALREADY_ROTATED_DETAIL = 'Refresh token was already rotated';

interface ApiErrorOptions {
  attemptsRemaining?: number;
  detail?: string;
  fieldErrors?: ApiFieldError[];
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

  /** The request fields the server's validation refused, where the refusal listed them */
  fieldErrors?: ApiFieldError[];

  constructor(message: string, status: number, options: ApiErrorOptions = {}) {
    super(message);
    // Without this the class inherits the plain Error name, so a copied bug report cannot tell a
    // request the server refused from a render that threw
    this.name = 'ApiError';
    this.status = status;
    this.attemptsRemaining = options.attemptsRemaining;
    this.detail = options.detail;
    this.fieldErrors = options.fieldErrors;
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

// Where a field error's location starts with the part of the request it was found in rather than
// the field's own name
const REQUEST_PARTS = new Set(['body', 'query', 'path', 'header', 'cookie']);

/** A request field the server's validation refused, and why */
export interface ApiFieldError {
  field: string;
  message: string;
}

/**
 * Reads the field errors from a validation refusal, whose `detail` is a list of
 * `{ loc, msg }` entries rather than a sentence
 */
function readFieldErrors(detail: unknown): ApiFieldError[] | undefined {
  if (!Array.isArray(detail)) return undefined;
  const fieldErrors = detail.flatMap((entry): ApiFieldError[] => {
    if (typeof entry !== 'object' || entry === null || typeof entry.msg !== 'string') return [];
    const loc: unknown[] = Array.isArray(entry.loc) ? entry.loc : [];
    const names = loc.filter((part): part is string => typeof part === 'string' && !REQUEST_PARTS.has(part));
    return [{ field: names.at(-1) ?? '', message: entry.msg }];
  });
  return fieldErrors.length > 0 ? fieldErrors : undefined;
}

// What a validation refusal shows when none of its entries names a field
const UNNAMED_FIELDS_MESSAGE = "Oops, some of what you entered wasn't accepted. Please check it and try again.";

/**
 * Says which fields a validation refusal named, as "the credit limit and name", leaving out the
 * server's reasons, which are written for developers and stay in the copied report
 */
function describeRefusedFields(fieldErrors: ApiFieldError[]): string {
  const names = [...new Set(fieldErrors.map(({ field }) => field.replaceAll('_', ' ').trim()).filter(Boolean))];
  if (names.length === 0) return UNNAMED_FIELDS_MESSAGE;
  const list = formatList(names);
  return names.length === 1
    ? `Oops, the ${list} wasn't accepted. Please check it and try again.`
    : `Oops, the ${list} weren't accepted. Please check them and try again.`;
}

/**
 * Builds the error a failed response stands for from its status and its parsed body, if any
 *
 * A sentence the server sent is the message. A validation refusal names the fields it refused and
 * keeps the server's reasons as `fieldErrors`. Anything else, including no body at all, gets the
 * friendly sentence, since a status code is not something a user can act on
 */
export function buildApiError(status: number, body: unknown, options: Omit<ApiErrorOptions, 'detail' | 'fieldErrors'> = {}): ApiError {
  const detail = typeof body === 'object' && body !== null ? (body as { detail?: unknown }).detail : undefined;
  if (typeof detail === 'string' && detail.trim()) return new ApiError(detail, status, { ...options, detail });

  const fieldErrors = readFieldErrors(detail);
  if (fieldErrors) {
    return new ApiError(describeRefusedFields(fieldErrors), status, { ...options, fieldErrors });
  }

  return new ApiError(NO_EXPLANATION_MESSAGE, status, options);
}
