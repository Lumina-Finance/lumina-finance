export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string | null;
  tz: string;
  base_currency: string;
  created_at: string;
  // True after a recovery-code login, holding the account to the forced re-enrolment screen
  totp_reenrollment_required: boolean;
}

export interface AuthResponse {
  user: User;
  access_token: string;
  token_type: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface SignupPayload {
  email: string;
  password: string;
  first_name: string;
  last_name?: string;
  tz: string;
  base_currency: string;
}

export interface ForgotPasswordPayload {
  email: string;
}

export interface ResetPasswordPayload {
  token: string;
  new_password: string;
}

export interface MfaRequiredResponse {
  mfa_required: true;
  mfa_token: string;
  // True once the authenticator is revoked, so the screen offers only the recovery-code input
  recovery_only: boolean;
}

/** Login returns tokens, or a challenge when the account has a second factor */
export type LoginResult = AuthResponse | MfaRequiredResponse;

export interface MfaVerifyPayload {
  mfa_token: string;
  code: string;
}
