export type {
  OidcAuthorizeResponse,
  OidcIdentitiesResponse,
  OidcLinkedIdentity,
  OidcCallbackPayload,
  OidcCallbackResult,
  OidcOnboardingResponse,
  OidcProvider,
  OidcProvidersResponse,
  OidcSignupPayload,
} from '@/api/oidc/types';

export {
  beginOidcLink,
  beginOidcReauth,
  beginOidcSignIn,
  completeOidcLinkCallback,
  completeOidcReauthCallback,
  completeOidcCallback,
  completeOidcSignup,
  fetchOidcIdentities,
  fetchOidcProviders,
  isOidcOnboardingRequired,
  removeOidcIdentity,
} from '@/api/oidc/requests';

export { useOidcIdentities, useOidcProviders, useRefreshOidcIdentities } from '@/api/oidc/hooks';

export { OidcEmailConflictError } from '@/api/oidc/errors';
