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
