import type { AuthenticationResponseJSON } from '@simplewebauthn/browser';

export interface TotpSetupResponse {
  /** Base32 secret for manual entry into an authenticator app */
  secret: string;
  /** otpauth URI rendered as a QR code */
  provisioning_uri: string;
}

export interface ConfirmTotpPayload {
  code: string;
}

export interface RecoveryCodesResponse {
  recovery_codes: string[];
}

export interface TotpStatusResponse {
  totp_enabled: boolean;
}

export interface StepUpPayload {
  password: string;
  /** A current TOTP code, used when stepping up by authenticator. Recovery codes are not accepted */
  code?: string;
  /** A passkey assertion, used when stepping up by passkey, taking priority over a code */
  passkey?: AuthenticationResponseJSON;
}
