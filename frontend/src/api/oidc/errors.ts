import { ApiError } from '@/api/auth/errors'

// Mirrors the backend's structured conflict code for a provider email it cannot auto-link
export const OIDC_EMAIL_CONFLICT_CODE = 'email_already_registered'

// Mirrors the backend's refusal when a provider sign-in would create an account on a closed instance
export const REGISTRATION_CLOSED_STATUS = 403
export const REGISTRATION_CLOSED_DETAIL = 'Registration is closed on this instance'

/**
 * Raised when a provider sign-in matches an existing account it cannot link automatically
 *
 * Carries the asserted address so the login page can offer a password sign-in with the
 * email already filled in
 */
export class OidcEmailConflictError extends ApiError {
  email: string

  constructor(email: string) {
    super('Email already registered', 409)
    this.email = email
  }
}

/**
 * Raised when a first-time provider sign-in or its onboarding is refused because registration is closed
 *
 * The callback page sends the user back to the login page to say so, rather than showing a failure
 */
export class RegistrationClosedError extends ApiError {
  constructor() {
    super(REGISTRATION_CLOSED_DETAIL, REGISTRATION_CLOSED_STATUS, { detail: REGISTRATION_CLOSED_DETAIL })
  }
}
