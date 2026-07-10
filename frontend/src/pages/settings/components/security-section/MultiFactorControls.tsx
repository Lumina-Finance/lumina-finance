import { useState } from 'react';
import { usePasskeys } from '@/api/passkeys';
import { useTotpStatus } from '@/api/twoFactor';
import { MultiFactorModal } from '@/pages/settings/components/security-section/MultiFactorModal';

const BADGE_BASE_CLASS = 'rounded-full px-2 py-0.5 text-xs font-medium';

const ON_BADGE_STYLE = {
  backgroundColor: 'var(--app-positive-soft)',
  color: 'var(--app-positive)',
};

const OFF_BADGE_STYLE = {
  borderColor: 'var(--app-border)',
  color: 'var(--app-text-subtle)',
};

interface MultiFactorControlsProps {
  // False for an account that signs in only through a provider, which cannot hold a local factor
  hasPassword: boolean;
}

/**
 * The security-card entry for multi-factor authentication: a status summary and a button that opens
 * the management modal where the authenticator app, passkeys, and recovery codes are managed
 *
 * A local factor only gates password and passkey sign-in, never a provider sign-in, which the provider
 * authenticates. A passwordless account has neither, so it cannot hold a factor and sees a reminder in
 * place of the controls
 */
export default function MultiFactorControls({ hasPassword }: MultiFactorControlsProps) {
  const status = useTotpStatus();
  const passkeys = usePasskeys();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const isLoading = status.isLoading || passkeys.isLoading;
  const isOn = (status.data?.totp_enabled ?? false) || (passkeys.data?.length ?? 0) > 0;

  if (!hasPassword) {
    return (
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Multi-factor authentication</h3>
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          Two-factor authentication is only requested when you sign in with a password or passkey. This
          account signs in through a provider, which handles authentication, so there's nothing to set up
          here. Set a password to enable it.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">Multi-factor authentication</h3>
            {!isLoading && (
              <span
                className={isOn ? BADGE_BASE_CLASS : `${BADGE_BASE_CLASS} border`}
                style={isOn ? ON_BADGE_STYLE : OFF_BADGE_STYLE}
              >
                {isOn ? 'On' : 'Off'}
              </span>
            )}
          </div>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Protect sign-in with an authenticator app or a passkey, backed by one-time recovery codes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          disabled={isLoading}
          className="app-secondary-button shrink-0"
        >
          Manage
        </button>
      </div>

      <MultiFactorModal open={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
}
