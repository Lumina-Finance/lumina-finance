import { ManagePasskeysDialog } from '@/components/passkeys/ManagePasskeysDialog';
import { RecoveryCodesModal } from '@/components/twoFactor/RecoveryCodesModal';
import { StepUpModal } from '@/components/twoFactor/StepUpModal';
import { TotpEnrollmentModal } from '@/components/twoFactor/TotpEnrollmentModal';
import { usePasskeyManagement } from '@/pages/settings/hooks/usePasskeyManagement';
import { useTwoFactorManagement } from '@/pages/settings/hooks/useTwoFactorManagement';

const BADGE_BASE_CLASS = 'rounded-full px-2 py-0.5 text-xs font-medium';

const ENABLED_BADGE_STYLE = {
  backgroundColor: 'var(--app-positive-soft)',
  color: 'var(--app-positive)',
};

const OFF_BADGE_STYLE = {
  borderColor: 'var(--app-border)',
  color: 'var(--app-text-subtle)',
};

const FIRST_PASSKEY_CODES_DESCRIPTION =
  "Save these recovery codes. They're the only way back into your account if you lose your passkey. You won't see them again.";

/**
 * One security-card section for every second factor: an authenticator app and passkeys, with a shared
 * recovery-code batch regenerated from its own row. Recovery codes are account-level, so regeneration
 * is offered whenever any factor is enrolled, not just for TOTP
 */
export default function MultiFactorControls() {
  const totp = useTwoFactorManagement();
  const passkey = usePasskeyManagement();

  const hasPasskeys = passkey.passkeys.length > 0;
  const hasAnyFactor = totp.isEnabled || hasPasskeys;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Multi-factor authentication</h3>
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          Protect sign-in with an authenticator app or a passkey, backed by one-time recovery codes.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold">Authenticator app</h4>
            {!totp.isStatusLoading && (
              <span
                className={totp.isEnabled ? BADGE_BASE_CLASS : `${BADGE_BASE_CLASS} border`}
                style={totp.isEnabled ? ENABLED_BADGE_STYLE : OFF_BADGE_STYLE}
              >
                {totp.isEnabled ? 'Enabled' : 'Off'}
              </span>
            )}
          </div>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            A one-time code from an authenticator app when you sign in.
          </p>
        </div>
        {totp.isEnabled ? (
          <button type="button" onClick={totp.showDisable} disabled={totp.isStatusLoading} className="app-danger-button shrink-0">
            Disable
          </button>
        ) : (
          <button type="button" onClick={totp.showEnable} disabled={totp.isStatusLoading} className="app-secondary-button shrink-0">
            Enable
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold">Passkeys</h4>
            {!passkey.isLoading && (
              <span
                className={hasPasskeys ? BADGE_BASE_CLASS : `${BADGE_BASE_CLASS} border`}
                style={hasPasskeys ? ENABLED_BADGE_STYLE : OFF_BADGE_STYLE}
              >
                {hasPasskeys ? `${passkey.passkeys.length} active` : 'Off'}
              </span>
            )}
          </div>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Sign in with your fingerprint, face, or device PIN instead of a password.
          </p>
        </div>
        <button type="button" onClick={passkey.openManage} disabled={passkey.isLoading} className="app-secondary-button shrink-0">
          Manage
        </button>
      </div>

      <div className="flex items-center justify-between gap-4 border-t pt-6" style={{ borderColor: 'var(--app-border)' }}>
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">Recovery codes</h4>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            One-time codes to sign in if you lose your authenticator and passkeys.
          </p>
        </div>
        <button
          type="button"
          onClick={totp.showRegenerate}
          disabled={!hasAnyFactor}
          className="app-secondary-button shrink-0"
        >
          Regenerate
        </button>
      </div>

      <TotpEnrollmentModal open={totp.openModal === 'enable'} onClose={totp.closeModal} />

      <StepUpModal
        open={totp.openModal === 'disable'}
        title="Turn off two-factor authentication"
        description="Confirm it's you to turn two-factor off."
        requirePassword
        confirmLabel="Turn off"
        danger
        allowPasskey
        allowRecoveryReset
        onClose={totp.closeModal}
        onVerify={totp.confirmDisable}
      />

      <StepUpModal
        open={totp.openModal === 'regenerate'}
        title="Regenerate recovery codes"
        description="Confirm it's you to replace your recovery codes."
        requirePassword
        confirmLabel="Regenerate"
        allowPasskey
        allowRecoveryReset
        onClose={totp.closeModal}
        onVerify={totp.confirmRegenerate}
      />

      <RecoveryCodesModal
        open={totp.regeneratedCodes !== null}
        codes={totp.regeneratedCodes}
        onConfirm={totp.acknowledgeRegeneratedCodes}
        onClose={totp.dismissRegeneratedCodes}
      />

      <ManagePasskeysDialog open={passkey.isManageOpen} onClose={passkey.closeManage} management={passkey} />

      <RecoveryCodesModal
        open={passkey.pendingRecoveryCodes !== null}
        codes={passkey.pendingRecoveryCodes}
        description={FIRST_PASSKEY_CODES_DESCRIPTION}
        onConfirm={passkey.acknowledgeRecoveryCodes}
        onClose={passkey.dismissRecoveryCodes}
      />

      <StepUpModal
        open={passkey.isRemovalOpen}
        title="Remove this passkey"
        description="Confirm it's you to remove this passkey."
        requirePassword
        confirmLabel="Remove"
        danger
        allowPasskey
        allowRecoveryReset
        onClose={passkey.cancelRemoval}
        onVerify={passkey.confirmRemoval}
      />
    </div>
  );
}
