import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { oidcKeys } from '@/api/cache/queryKeys';
import {
  beginOidcLink,
  beginOidcReauth,
  removeOidcIdentity,
  useOidcIdentities,
  useOidcProviders,
  type OidcLinkedIdentity,
  type OidcProvider,
} from '@/api/oidc';
import { ProviderMark } from '@/components/ProviderMark';
import { StepUpModal, type StepUpCredentials } from '@/components/twoFactor/StepUpModal';
import { SetPasswordModal } from '@/pages/settings/components/security-section/SetPasswordModal';
import { markOidcIntent } from '@/utils/oidcIntent';
import { withMinDelay } from '@/utils/timing';

// Operator documentation for configuring providers, shown when none are available
const OIDC_SETUP_DOCS_URL = 'https://github.com/Lumina-Finance/lumina-finance#single-sign-on-oidc';

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
  const location = useLocation();
  const navigate = useNavigate();
  const providers = useOidcProviders();
  const identities = useOidcIdentities();

  const [linkTarget, setLinkTarget] = useState<ProviderRow | null>(null);
  const [removeTarget, setRemoveTarget] = useState<OidcLinkedIdentity | null>(null);
  const [reauthingSlug, setReauthingSlug] = useState<string | null>(null);

  const sectionRef = useRef<HTMLDivElement>(null);

  // Captured once on mount so the arrival cues survive clearing the navigation state
  const [justLinkedSlug] = useState<string | null>(
    () => (location.state as { linkedProvider?: string } | null)?.linkedProvider ?? null,
  );

  // A completed reauth returns here to open the set-password form
  const [setPasswordOpen, setSetPasswordOpen] = useState<boolean>(
    () => (location.state as { setPassword?: boolean } | null)?.setPassword === true,
  );

  const linkedIdentities = identities.data?.identities ?? [];
  const hasPassword = identities.data?.has_password ?? true;
  const rows = buildProviderRows(providers.data ?? [], linkedIdentities);

  const isLoading = providers.isLoading || identities.isLoading;

  // A fresh link centres its section and consumes the state, so a reload or back
  // navigation does not replay the scroll and blink
  const identitiesReady = identities.data !== undefined;
  useEffect(() => {
    if ((!justLinkedSlug && !setPasswordOpen) || !identitiesReady) return;
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    navigate(location.pathname, { replace: true, state: null });
  }, [justLinkedSlug, setPasswordOpen, identitiesReady, navigate, location.pathname]);

  // The section stays visible without providers so operators discover the feature, with
  // the guidance split between a server that offers none and one that failed to answer
  const configurationBroken = providers.isError || identities.isError;
  const nothingConfigured = !isLoading && !configurationBroken && rows.length === 0;

  const confirmLink = async (credentials: StepUpCredentials) => {
    if (!linkTarget) return;
    const { authorization_url } = await beginOidcLink(linkTarget.slug, credentials);

    // The browser leaves for the provider, so the callback needs to know this return links
    markOidcIntent('link');
    window.location.assign(authorization_url);
  };

  const startSetPassword = async (slug: string) => {
    setReauthingSlug(slug);
    try {
      const { authorization_url } = await beginOidcReauth(slug);

      // The reauth return finishes the set-password flow, not a link
      markOidcIntent('reauth');
      window.location.assign(authorization_url);
    } catch {
      setReauthingSlug(null);
    }
  };

  const finishSetPassword = async () => {
    setSetPasswordOpen(false);

    // The account now has a password, so the section flips to showing link and unlink
    await queryClient.invalidateQueries({ queryKey: oidcKeys.identities() });
  };

  const confirmRemove = async (credentials: StepUpCredentials) => {
    if (!removeTarget) return;

    // Hold the modal's pending state to the shared minimum so a fast unlink does not flash
    await withMinDelay(() => removeOidcIdentity(removeTarget.id, credentials));
    setRemoveTarget(null);
    await queryClient.invalidateQueries({ queryKey: oidcKeys.identities() });
  };

  return (
    <>
      <div ref={sectionRef} className="space-y-4">
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

        {!hasPassword && linkedIdentities.length > 0 && (
          <div className="space-y-3 rounded-xl border px-4 py-3" style={{ borderColor: 'var(--app-border)' }}>
            <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              This account signs in only through a provider. Set a password to sign in without one and
              to manage your providers. You'll re-confirm it's you with a provider first.
            </p>
            <div className="flex flex-wrap gap-2">
              {linkedIdentities.map((identity) => (
                <button
                  key={identity.id}
                  type="button"
                  className={`app-secondary-button flex items-center gap-2 ${
                    reauthingSlug === identity.provider_slug ? 'app-primary-button-loading' : ''
                  }`}
                  disabled={reauthingSlug !== null}
                  onClick={() => startSetPassword(identity.provider_slug)}
                >
                  {reauthingSlug === identity.provider_slug ? (
                    <div className="app-spinner" />
                  ) : (
                    <>
                      <ProviderMark slug={identity.provider_slug} name={identity.provider_display_name} />
                      Set a password with {identity.provider_display_name}
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.slug}
              className="flex items-center gap-3 rounded-xl border px-4 py-3"
              style={{ borderColor: 'var(--app-border)' }}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center" aria-hidden>
                <ProviderMark slug={row.slug} name={row.displayName} size={18} />
              </span>

              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{row.displayName}</p>
                  {row.identity && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.slug === justLinkedSlug ? 'app-blink-thrice' : ''
                      }`}
                      style={LINKED_BADGE_STYLE}
                    >
                      Linked
                    </span>
                  )}
                </div>
                <p className="truncate text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  {row.identity ? row.identity.email : 'Not linked'}
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

      <SetPasswordModal
        open={setPasswordOpen}
        onClose={() => setSetPasswordOpen(false)}
        onDone={finishSetPassword}
      />
    </>
  );
}
