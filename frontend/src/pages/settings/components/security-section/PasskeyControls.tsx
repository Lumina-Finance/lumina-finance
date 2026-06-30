import { ManagePasskeysDialog } from '@/components/passkeys/ManagePasskeysDialog';
import { RecoveryCodesModal } from '@/components/twoFactor/RecoveryCodesModal';
import { StepUpModal } from '@/components/twoFactor/StepUpModal';
import { usePasskeyManagement } from '@/pages/settings/hooks/usePasskeyManagement';

const BADGE_BASE_CLASS = 'rounded-full px-2 py-0.5 text-xs font-medium';

const FIRST_PASSKEY_CODES_DESCRIPTION =
  "Save these recovery codes. They're the only way back into your account if you lose your passkey. You won't see them again.";

const ACTIVE_BADGE_STYLE = {
  backgroundColor: 'var(--app-positive-soft)',
  color: 'var(--app-positive)',
};

const OFF_BADGE_STYLE = {
  borderColor: 'var(--app-border)',
  color: 'var(--app-text-subtle)',
};

/**
 * Shows how many passkeys are registered as a status badge, with a single Manage button that opens the
 * passkey dialog. Sits in the security card beneath the two-factor controls
 */
export default function PasskeyControls() {
  const management = usePasskeyManagement();
  const count = management.passkeys.length;
  const hasPasskeys = count > 0;

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">Passkeys</h3>
            {!management.isLoading && (
              <span
                className={hasPasskeys ? BADGE_BASE_CLASS : `${BADGE_BASE_CLASS} border`}
                style={hasPasskeys ? ACTIVE_BADGE_STYLE : OFF_BADGE_STYLE}
              >
                {hasPasskeys ? `${count} active` : 'Off'}
              </span>
            )}
          </div>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Sign in with your fingerprint, face, or device PIN instead of a password.
          </p>
        </div>

        <button
          type="button"
          onClick={management.openManage}
          disabled={management.isLoading}
          className="app-secondary-button shrink-0"
        >
          Manage
        </button>
      </div>

      <ManagePasskeysDialog
        open={management.isManageOpen}
        onClose={management.closeManage}
        support={management.support}
        passkeys={management.passkeys}
        onRegister={management.registerPasskey}
        isRegistering={management.isRegistering}
        reuseReminder={management.reuseReminder}
        onRename={management.renamePasskey}
        onRemove={management.beginRemovePasskey}
        isMutating={management.isMutating}
      />

      <RecoveryCodesModal
        open={management.pendingRecoveryCodes !== null}
        codes={management.pendingRecoveryCodes}
        description={FIRST_PASSKEY_CODES_DESCRIPTION}
        onConfirm={management.acknowledgeRecoveryCodes}
        onClose={management.dismissRecoveryCodes}
      />

      <StepUpModal
        open={management.isRemovalOpen}
        title="Remove this passkey"
        description="Enter your password and verify with a passkey or a current code to remove it."
        requirePassword
        confirmLabel="Remove"
        danger
        allowPasskey
        allowRecoveryReset
        onClose={management.cancelRemoval}
        onVerify={management.confirmRemoval}
      />
    </>
  );
}
