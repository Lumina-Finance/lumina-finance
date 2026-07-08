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
import { ProviderMark } from '@/components/ProviderMark';
import { StepUpModal, type StepUpCredentials } from '@/components/twoFactor/StepUpModal';

const MARK_TILE_STYLE = {
  backgroundColor: 'var(--app-surface-soft)',
  border: '1px solid var(--app-border)',
};

/**
 * Renders a provider mark inside the soft tile the settings rows and buttons lead with
 */
function ProviderMarkTile({ slug }: { slug: string }) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
      style={MARK_TILE_STYLE}
      aria-hidden
    >
      <ProviderMark slug={slug} size={18} />
    </span>
  );
}

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

  const isLoading = providers.isLoading || identities.isLoading;

  // Nothing to manage when the server has no providers and the account has no links
  if (!isLoading && (providers.data ?? []).length === 0 && linkedIdentities.length === 0) {
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
            Linked providers add another way to sign in alongside your password.
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
                className="flex items-center gap-3 rounded-xl border px-4 py-3"
                style={{ borderColor: 'var(--app-border)' }}
              >
                <ProviderMarkTile slug={identity.provider_slug} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-medium">{identity.provider_display_name}</p>
                  <p className="truncate text-sm" style={{ color: 'var(--app-text-muted)' }}>
                    {identity.email ?? 'No email on record'}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {hasPassword && (
                    <button
                      type="button"
                      className="text-sm font-medium underline underline-offset-2 transition-colors duration-200"
                      style={{ color: 'var(--app-negative)' }}
                      onClick={() => setRemoveTarget(identity)}
                    >
                      Remove
                    </button>
                  )}
                  <span className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
                    Linked {new Date(identity.created_at).toLocaleDateString()}
                  </span>
                </div>
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
                className="app-secondary-button flex items-center gap-2"
                onClick={() => setLinkTarget(provider)}
              >
                <ProviderMark slug={provider.slug} />
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
