import { ApiError } from '@/api/auth/errors'

// Mirrors the backend's structured conflict code for a provider email it cannot auto-link
export const OIDC_EMAIL_CONFLICT_CODE = 'email_already_registered'

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
