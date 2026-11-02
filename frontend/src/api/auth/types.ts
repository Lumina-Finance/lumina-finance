import type { DateFormatSetting } from '@/utils/dateFormat';

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string | null;
  tz: string;
  base_currency: string;
  date_format: DateFormatSetting;
  created_at: string;
  // True after a recovery-code login, holding the account to the forced re-enrolment screen
  second_factor_reenrollment_required: boolean;
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

// Sign-up asks for no password: the person chooses it when they open the emailed link
export interface SignupPayload {
  email: string;
  first_name: string;
  last_name?: string;
  tz: string;
  base_currency: string;
}

export type ConfirmSignupPayload = {
  /** Signed token from the emailed confirmation link */
  token: string;
  new_password: string;
};

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
  // An authenticator code can be used
  totp_enabled: boolean;
  // A passkey can be used, the preferred factor when present
  passkey_available: boolean;
  // True once no usable factor remains, so the screen offers only the recovery-code input
  recovery_only: boolean;
}

/** Login returns tokens, or a challenge when the account has a second factor */
export type LoginResult = AuthResponse | MfaRequiredResponse;

/** Reset completes immediately (null), or challenges when the account has a second factor */
export type ResetPasswordResult = MfaRequiredResponse | null;

/** Whether the instance lets new accounts be created, which decides if the login page offers sign-up */
export type RegistrationStatus = {
  enabled: boolean;
};

export interface MfaVerifyPayload {
  mfa_token: string;
  code: string;
}

export interface ResetPasswordVerifyPayload {
  token: string;
  new_password: string;
  mfa_token: string;
  code: string;
}
