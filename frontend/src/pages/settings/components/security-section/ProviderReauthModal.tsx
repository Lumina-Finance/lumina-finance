import type { OidcLinkedIdentity } from '@/api/oidc';
import { ProviderMark } from '@/components/ProviderMark';
import { ModalContentPanel } from '@/components/modal/ContentPanel';

interface ProviderReauthModalProps {
  open: boolean;
  providers: OidcLinkedIdentity[];
  busySlug: string | null;
  onChoose: (slug: string) => void;
  onClose: () => void;
}

/**
 * Lets a passwordless account pick which linked provider to re-confirm with before a sensitive action
 *
 * Only shown when several providers are linked, since a single one is chosen automatically
 */
export function ProviderReauthModal({ open, providers, busySlug, onChoose, onClose }: ProviderReauthModalProps) {
  return (
    <ModalContentPanel open={open} onClose={onClose} closeDisabled={busySlug !== null} titleId="provider-reauth-title">
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 id="provider-reauth-title" className="text-base font-semibold">Confirm it's you</h3>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Choose a provider to re-confirm your identity before continuing.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {providers.map((identity) => (
            <button
              key={identity.id}
              type="button"
              className={`app-secondary-button flex items-center gap-2 ${
                busySlug === identity.provider_slug ? 'app-primary-button-loading' : ''
              }`}
              disabled={busySlug !== null}
              onClick={() => onChoose(identity.provider_slug)}
            >
              {busySlug === identity.provider_slug ? (
                <div className="app-spinner" />
              ) : (
                <>
                  <ProviderMark name={identity.provider_display_name} />
                  {identity.provider_display_name}
                </>
              )}
            </button>
          ))}
        </div>
      </div>
    </ModalContentPanel>
  );
}
