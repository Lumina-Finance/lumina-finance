import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { ProviderReauthModal } from '@/pages/settings/components/security-section/ProviderReauthModal';
import { useProviderReauth } from '@/pages/settings/hooks/useProviderReauth';
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
 * The security-card entry for single sign-on: one row per provider showing its linked state, with
 * link and unlink actions
 *
 * An account with a password steps up with it. A passwordless account has none, so it re-confirms
 * with a linked provider instead, which returns here to resume the action it started
 */
export default function SignInProviderControls() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const providers = useOidcProviders();
  const identities = useOidcIdentities();
  const reauth = useProviderReauth();

  const [linkTarget, setLinkTarget] = useState<ProviderRow | null>(null);
  const [removeTarget, setRemoveTarget] = useState<OidcLinkedIdentity | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const sectionRef = useRef<HTMLDivElement>(null);

  // Captured once on mount so the arrival cues survive clearing the navigation state
  const [justLinkedSlug] = useState<string | null>(
    () => (location.state as { linkedProvider?: string } | null)?.linkedProvider ?? null,
  );

  const linkedIdentities = identities.data?.identities ?? [];
  const hasPassword = identities.data?.has_password ?? true;
  const rows = buildProviderRows(providers.data ?? [], linkedIdentities);

  const isLoading = providers.isLoading || identities.isLoading;

  // A fresh link centres its section and consumes the state, so a reload or back navigation does not
  // replay the scroll and blink
  const identitiesReady = identities.data !== undefined;
  useEffect(() => {
    if (!justLinkedSlug || !identitiesReady) return;
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    navigate(location.pathname, { replace: true, state: null });
  }, [justLinkedSlug, identitiesReady, navigate, location.pathname]);

  // A passwordless reauth returns here to resume the action it stepped up for, then clears the state
  // so a reload does not replay it. Linking a new provider begins its own roundtrip, unlinking commits
  const resumeRef = useRef(false);
  useEffect(() => {
    if (resumeRef.current) return;
    const navState = location.state as { resumeLink?: string; resumeUnlink?: string } | null;
    if (!navState?.resumeLink && !navState?.resumeUnlink) return;
    resumeRef.current = true;
    navigate(location.pathname, { replace: true, state: null });

    if (navState.resumeLink) {
      const slug = navState.resumeLink;
      beginOidcLink(slug)
        .then(({ authorization_url }) => {
          markOidcIntent({ flow: 'link' });
          window.location.assign(authorization_url);
        })
        .catch((error: Error) => setResumeError(error.message || 'Could not continue linking the provider.'));
    } else if (navState.resumeUnlink) {
      const identityId = navState.resumeUnlink;
      withMinDelay(() => removeOidcIdentity(identityId))
        .then(() => queryClient.invalidateQueries({ queryKey: oidcKeys.identities() }))
        .catch((error: Error) => setResumeError(error.message || 'Could not remove the provider.'));
    }
  }, [location.state, location.pathname, navigate, queryClient]);

  // The section stays visible without providers so operators discover the feature, with the guidance
  // split between a server that offers none and one that failed to answer
  const configurationBroken = providers.isError || identities.isError;
  const nothingConfigured = !isLoading && !configurationBroken && rows.length === 0;

  // A password steps up through the modal, otherwise a linked provider re-confirms it is you
  const startLink = (row: ProviderRow) => {
    setResumeError(null);
    if (hasPassword) {
      setLinkTarget(row);
    } else {
      reauth.start({ kind: 'link', slug: row.slug });
    }
  };

  const startUnlink = (identity: OidcLinkedIdentity) => {
    setResumeError(null);
    if (hasPassword) {
      setRemoveTarget(identity);
    } else {
      reauth.start({ kind: 'unlink', identityId: identity.id });
    }
  };

  const confirmLink = async (credentials: StepUpCredentials) => {
    if (!linkTarget) return;
    const { authorization_url } = await beginOidcLink(linkTarget.slug, credentials);

    // The browser leaves for the provider, so the callback needs to know this return links
    markOidcIntent({ flow: 'link' });
    window.location.assign(authorization_url);
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
            Linked providers are ways to sign in to your account.
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

        {resumeError && (
          <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
            {resumeError}
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
              <span className="flex h-9 w-9 shrink-0 items-center justify-center" aria-hidden>
                <ProviderMark name={row.displayName} size={18} />
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

              {row.identity && (
                <button
                  type="button"
                  className="app-secondary-button shrink-0"
                  disabled={reauth.busySlug !== null}
                  onClick={() => startUnlink(row.identity as OidcLinkedIdentity)}
                >
                  Unlink
                </button>
              )}

              {!row.identity && row.offered && (
                <button
                  type="button"
                  className="app-secondary-button shrink-0"
                  disabled={reauth.busySlug !== null}
                  onClick={() => startLink(row)}
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

      <ProviderReauthModal
        open={reauth.chooserOpen}
        providers={reauth.linkedProviders}
        busySlug={reauth.busySlug}
        onChoose={reauth.chooseProvider}
        onClose={reauth.closeChooser}
      />
    </>
  );
}
