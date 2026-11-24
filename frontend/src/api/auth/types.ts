import type { DateFormatSetting } from '@/utils/dateFormat'

export interface User {
  id: string
  email: string
  first_name: string
  last_name: string | null
  tz: string
  base_currency: string
  date_format: DateFormatSetting
  created_at: string
  // True after a recovery-code login, holding the account to the forced re-enrolment screen
  second_factor_reenrollment_required: boolean
  // When the profile is deleted, as an ISO time, while a deletion waits to run. Holds the app to the
  // cancel screen until then
  deletion_due_at: string | null
}

export interface AuthResponse {
  user: User
  access_token: string
  token_type: string
  // The key for the saved copy of the user's data, as unpadded base64url, and the number it belongs
  // to. Sent to browsers only, left out of a native app's response
  saved_copy_key?: string
  saved_copy_key_version?: number
}

export interface LoginPayload {
  email: string
  password: string
}

// Sign-up asks for no password: the person chooses it when they open the emailed link
export interface SignupPayload {
  email: string
  first_name: string
  last_name?: string
  tz: string
  base_currency: string
}

export type ConfirmSignupPayload = {
  /** Signed token from the emailed confirmation link */
  token: string
  new_password: string
}

export interface ForgotPasswordPayload {
  email: string
}

export interface ResetPasswordPayload {
  token: string
  new_password: string
}

export interface MfaRequiredResponse {
  mfa_required: true
  mfa_token: string
  // An authenticator code can be used
  totp_enabled: boolean
  // A passkey can be used, the preferred factor when present
  passkey_available: boolean
  // True once no usable factor remains, so the screen offers only the recovery-code input
  recovery_only: boolean
}

/** Login returns tokens, or a challenge when the account has a second factor */
export type LoginResult = AuthResponse | MfaRequiredResponse

/** A finished reset answers with this only when it also removed the account's linked sign-in providers */
export type PasswordResetResponse = {
  /** How many providers it removed, at least one */
  sign_in_providers_removed: number
}

/** What a reset from a still-valid link would also remove, read before the new password is chosen */
export type ResetLinkStatus = {
  /** How many sign-in providers the account has linked, zero for most accounts */
  sign_in_providers_linked: number
}

/** A finished reset, null when the password is all that changed */
export type CompletedPasswordReset = PasswordResetResponse | null

/** Reset completes immediately, or challenges when the account has a second factor */
export type ResetPasswordResult = MfaRequiredResponse | CompletedPasswordReset

/** Whether the instance lets new accounts be created, which decides if the login page offers sign-up */
export type RegistrationStatus = {
  enabled: boolean
}

/** The address an account has once its emailed confirmation link is used */
export type ConfirmedEmailChange = {
  email: string
}

export interface MfaVerifyPayload {
  mfa_token: string
  code: string
}

export interface ResetPasswordVerifyPayload {
  token: string
  new_password: string
  mfa_token: string
  code: string
}
