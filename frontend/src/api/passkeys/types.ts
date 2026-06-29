import type { RegistrationResponseJSON } from '@simplewebauthn/browser';

/** A registered passkey as shown in the security settings list */
export interface Passkey {
  id: string;
  name: string;
  /** ISO-8601 UTC timestamp of when the passkey was registered */
  created_at: string;
  /** ISO-8601 UTC timestamp of the most recent sign-in, null until the passkey is first used */
  last_used_at: string | null;
}

/** Public passkey settings the client needs before starting a ceremony */
export interface PasskeyConfig {
  /** Relying party id the browser binds passkeys to, blank when passkeys are unconfigured */
  rp_id: string;
}

/** A finished registration ceremony paired with the label to store it under */
export interface RegisterPasskeyPayload {
  name: string;
  credential: RegistrationResponseJSON;
}
