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
  beginOidcSignIn,
  completeOidcLinkCallback,
  completeOidcCallback,
  completeOidcSignup,
  fetchOidcIdentities,
  fetchOidcProviders,
  isOidcOnboardingRequired,
  removeOidcIdentity,
} from '@/api/oidc/requests';

export { useOidcIdentities, useOidcProviders } from '@/api/oidc/hooks';

export { OidcEmailConflictError } from '@/api/oidc/errors';
