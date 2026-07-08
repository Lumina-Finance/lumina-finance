import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { oidcKeys } from '@/api/cache/queryKeys';
import {
  beginOidcLink,
  removeOidcIdentity,
  useOidcIdentities,
  useOidcProviders,
  type OidcLinkedIdentity,
  type OidcProvider,
} from '@/api/oidc';
import { StepUpModal, type StepUpCredentials } from '@/components/twoFactor/StepUpModal';

/**
 * The security-card entry for single sign-on: linked providers with their unlink actions and
 * a link button per remaining provider, both behind step-up
 *
 * An account created through a provider has no password, so the actions are replaced by a
 * prompt to set one first through the password reset email
 */
export default function SignInProviderControls() {
  const queryClient = useQueryClient();
  const providers = useOidcProviders();
  const identities = useOidcIdentities();

  const [linkTarget, setLinkTarget] = useState<OidcProvider | null>(null);
  const [removeTarget, setRemoveTarget] = useState<OidcLinkedIdentity | null>(null);

  const linkedIdentities = identities.data?.identities ?? [];
  const hasPassword = identities.data?.has_password ?? true;

  const unlinkedProviders = (providers.data ?? []).filter(
    (provider) => !linkedIdentities.some((identity) => identity.provider_slug === provider.slug),
  );

  // Nothing to manage when the server has no providers and the account has no links
  if (!providers.isLoading && !identities.isLoading && (providers.data ?? []).length === 0 && linkedIdentities.length === 0) {
    return null;
  }

  const confirmLink = async (credentials: StepUpCredentials) => {
    if (!linkTarget) return;
    const { authorization_url } = await beginOidcLink(linkTarget.slug, credentials);

    // The browser leaves for the provider, so the modal stays open until navigation lands
    window.location.assign(authorization_url);
  };

  const confirmRemove = async (credentials: StepUpCredentials) => {
    if (!removeTarget) return;
    await removeOidcIdentity(removeTarget.id, credentials);
    setRemoveTarget(null);
    await queryClient.invalidateQueries({ queryKey: oidcKeys.identities() });
  };

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">Sign-in providers</h3>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Sign in with a linked provider instead of your password.
          </p>
        </div>

        {!hasPassword && (
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Managing providers needs a password on the account. Set one first with the reset
            link from the login page's Forgot password option.
          </p>
        )}

        {linkedIdentities.length > 0 && (
          <ul className="space-y-3">
            {linkedIdentities.map((identity) => (
              <li
                key={identity.id}
                className="flex flex-col gap-2 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                style={{ borderColor: 'var(--app-border)' }}
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{identity.provider_display_name}</p>
                  <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                    {identity.email ?? 'No email on record'} · linked{' '}
                    {new Date(identity.created_at).toLocaleDateString()}
                  </p>
                </div>
                {hasPassword && (
                  <button
                    type="button"
                    className="text-sm font-medium underline underline-offset-2"
                    style={{ color: 'var(--app-negative)' }}
                    onClick={() => setRemoveTarget(identity)}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {hasPassword && unlinkedProviders.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {unlinkedProviders.map((provider) => (
              <button
                key={provider.slug}
                type="button"
                className="app-secondary-button"
                onClick={() => setLinkTarget(provider)}
              >
                Link {provider.display_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <StepUpModal
        open={linkTarget !== null}
        title={`Link ${linkTarget?.display_name ?? 'provider'}`}
        description="Confirm it's you before continuing to the provider."
        requirePassword
        confirmLabel="Continue"
        allowPasskey
        onClose={() => setLinkTarget(null)}
        onVerify={confirmLink}
      />

      <StepUpModal
        open={removeTarget !== null}
        title={`Remove ${removeTarget?.provider_display_name ?? 'provider'}`}
        description="Confirm it's you to remove this sign-in provider."
        requirePassword
        confirmLabel="Remove"
        danger
        allowPasskey
        onClose={() => setRemoveTarget(null)}
        onVerify={confirmRemove}
      />
    </>
  );
}
