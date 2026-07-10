import type { AuthResponse } from '@/api/auth/types';

export interface OidcProvider {
  slug: string;
  display_name: string;
}

export interface OidcProvidersResponse {
  providers: OidcProvider[];
}

export interface OidcAuthorizeResponse {
  authorization_url: string;
}

export interface OidcCallbackPayload {
  code: string;
  state: string;
}

// Returned when a first-time sign-in still needs the profile fields before an account exists
export interface OidcOnboardingResponse {
  onboarding_required: true;
  onboarding_token: string;
  email: string;
  first_name: string;
  last_name: string | null;
}

/** The callback signs an existing account in, or hands back the onboarding step for a new one */
export type OidcCallbackResult = AuthResponse | OidcOnboardingResponse;

export interface OidcSignupPayload {
  onboarding_token: string;
  first_name: string;
  last_name?: string;
  tz: string;
  base_currency: string;
}

// A linked provider as shown in the security settings list
export interface OidcLinkedIdentity {
  id: string;
  provider_slug: string;
  provider_display_name: string;
  // Every linked identity carries the email the provider asserted, required by the backend
  email: string;
  created_at: string;
  last_login_at: string | null;
}

export interface OidcIdentitiesResponse {
  identities: OidcLinkedIdentity[];
  // False for provider-created accounts until they set a password, which gates link and unlink
  has_password: boolean;
}
