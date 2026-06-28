import { TwoFactorModalShell } from '@/components/twoFactor/TwoFactorModalShell';

interface ManageTwoFactorDialogProps {
  open: boolean;
  isEnabled: boolean;
  onClose: () => void;
  onSetUp: () => void;
  onRegenerate: () => void;
  onDisable: () => void;
}

/**
 * Hub dialog for two-factor authentication, offering setup when it is off and the rotate and turn-off
 * actions when it is on. Each action hands off to its own focused modal rather than stacking on this one
 */
export function ManageTwoFactorDialog({
  open,
  isEnabled,
  onClose,
  onSetUp,
  onRegenerate,
  onDisable,
}: ManageTwoFactorDialogProps) {
  return (
    <TwoFactorModalShell open={open} onClose={onClose}>
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Two-factor authentication</h3>
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          {isEnabled
            ? 'Two-factor authentication is on. You can rotate your recovery codes or turn it off.'
            : 'Add a one-time code from an authenticator app to your sign-in for extra protection.'}
        </p>
      </div>

      {isEnabled ? (
        <div className="space-y-3">
          <button type="button" onClick={onRegenerate} className="app-secondary-button w-full">
            Regenerate recovery codes
          </button>
          <button type="button" onClick={onDisable} className="app-danger-button w-full">
            Turn off two-factor
          </button>
        </div>
      ) : (
        <button type="button" onClick={onSetUp} className="app-primary-button w-full">
          Set up two-factor
        </button>
      )}
    </TwoFactorModalShell>
  );
}
