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

// Operator documentation for configuring providers, shown when none are available
const OIDC_SETUP_DOCS_URL = 'https://github.com/Lumina-Finance/lumina-finance#single-sign-on-oidc';

const MARK_TILE_STYLE = {
  backgroundColor: 'var(--app-surface-soft)',
  border: '1px solid var(--app-border)',
};

const LINKED_BADGE_STYLE = {
  backgroundColor: 'var(--app-positive-soft)',
  color: 'var(--app-positive)',
};

// One row per provider the server offers or the account has linked, so a link that
// outlived its provider configuration still shows instead of silently disappearing
interface ProviderRow {
  slug: string;
  displayName: string;
  identity: OidcLinkedIdentity | null;
  offered: boolean;
}

/**
 * Builds the unified row list from the offered providers and the account's linked identities
 */
function buildProviderRows(
  providers: OidcProvider[],
  identities: OidcLinkedIdentity[],
): ProviderRow[] {
  const rows: ProviderRow[] = providers.map((provider) => ({
    slug: provider.slug,
    displayName: provider.display_name,
    identity: identities.find((identity) => identity.provider_slug === provider.slug) ?? null,
    offered: true,
  }));

  for (const identity of identities) {
    if (!rows.some((row) => row.slug === identity.provider_slug)) {
      rows.push({
        slug: identity.provider_slug,
        displayName: identity.provider_display_name,
        identity,
        offered: false,
      });
    }
  }
  return rows;
}

/**
 * The security-card entry for single sign-on: one row per provider showing its linked
 * state, with link and unlink actions behind step-up
 *
 * An account created through a provider has no password, so the actions are replaced by a
 * prompt to set one first through the password reset email
 */
export default function SignInProviderControls() {
  const queryClient = useQueryClient();
  const providers = useOidcProviders();
  const identities = useOidcIdentities();

  const [linkTarget, setLinkTarget] = useState<ProviderRow | null>(null);
  const [removeTarget, setRemoveTarget] = useState<OidcLinkedIdentity | null>(null);

  const linkedIdentities = identities.data?.identities ?? [];
  const hasPassword = identities.data?.has_password ?? true;
  const rows = buildProviderRows(providers.data ?? [], linkedIdentities);

  const isLoading = providers.isLoading || identities.isLoading;

  // The section stays visible without providers so operators discover the feature, with
  // the guidance split between a server that offers none and one that failed to answer
  const configurationBroken = providers.isError || identities.isError;
  const nothingConfigured = !isLoading && !configurationBroken && rows.length === 0;

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

        {(nothingConfigured || configurationBroken) && (
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {configurationBroken
              ? 'Sign-in providers could not be loaded, so the server configuration may be incomplete. '
              : 'No sign-in providers are configured on this server. '}
            <a
              href={OIDC_SETUP_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-2"
              style={{ color: 'var(--app-accent)' }}
            >
              See the setup guide
            </a>
            .
          </p>
        )}

        {!hasPassword && (
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Managing providers needs a password on the account. Set one first with the reset
            link from the login page's Forgot password option.
          </p>
        )}

        {rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.slug}
              className="flex items-center gap-3 rounded-xl border px-4 py-3"
              style={{ borderColor: 'var(--app-border)' }}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={MARK_TILE_STYLE}
                aria-hidden
              >
                <ProviderMark slug={row.slug} size={18} />
              </span>

              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{row.displayName}</p>
                  {row.identity && (
                    <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={LINKED_BADGE_STYLE}>
                      Linked
                    </span>
                  )}
                </div>
                <p className="truncate text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  {row.identity
                    ? (row.identity.email ?? 'No email on record')
                    : 'Not linked'}
                  {row.identity && !row.offered && ' · no longer offered by this server'}
                </p>
              </div>

              {hasPassword && row.identity && (
                <button
                  type="button"
                  className="app-secondary-button shrink-0"
                  onClick={() => setRemoveTarget(row.identity)}
                >
                  Unlink
                </button>
              )}

              {hasPassword && !row.identity && row.offered && (
                <button
                  type="button"
                  className="app-secondary-button shrink-0"
                  onClick={() => setLinkTarget(row)}
                >
                  Link
                </button>
              )}
            </li>
          ))}
        </ul>
        )}
      </div>

      <StepUpModal
        open={linkTarget !== null}
        title={`Link ${linkTarget?.displayName ?? 'provider'}`}
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
