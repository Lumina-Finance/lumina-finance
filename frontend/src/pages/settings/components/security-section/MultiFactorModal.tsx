import { useState } from 'react';
import { Fingerprint, KeyRound, Plus, RefreshCw, Smartphone } from 'lucide-react';
import { PasskeyRow } from '@/components/passkeys/PasskeyRow';
import { MultiFactorModalShell } from '@/components/twoFactor/MultiFactorModalShell';
import { RecoveryCodesModal } from '@/components/twoFactor/RecoveryCodesModal';
import { StepUpModal } from '@/components/twoFactor/StepUpModal';
import { TotpEnrollmentModal } from '@/components/twoFactor/TotpEnrollmentModal';
import { TwoFactorModalShell } from '@/components/twoFactor/TwoFactorModalShell';
import { WarningCallout } from '@/components/twoFactor/WarningCallout';
import { usePasskeyManagement } from '@/pages/settings/hooks/usePasskeyManagement';
import { useTwoFactorManagement } from '@/pages/settings/hooks/useTwoFactorManagement';
import { getPasskeyRegistrationMessage } from '@/utils/passkeyErrors';

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

interface MultiFactorModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The framed multi-factor management hub. The body manages the authenticator app, passkeys, and
 * recovery codes inline, while enrolment, step-up, codes, and warnings open as secondary modals that
 * stack on top, so the hub stays put underneath and cannot be dismissed while one is showing
 */
export function MultiFactorModal({ open, onClose }: MultiFactorModalProps) {
  const totp = useTwoFactorManagement();
  const passkey = usePasskeyManagement();
  const [isAddingPasskey, setIsAddingPasskey] = useState(false);
  const [passkeyName, setPasskeyName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const hasPasskeys = passkey.passkeys.length > 0;
  const hasAnyFactor = totp.isEnabled || hasPasskeys;
  const canRegisterPasskey = passkey.support?.supported === true;

  const isSecondaryOpen =
    totp.openModal !== 'none' ||
    totp.regeneratedCodes !== null ||
    passkey.pendingRecoveryCodes !== null ||
    passkey.reuseReminder ||
    passkey.isRemovalOpen;

  const resetAddForm = () => {
    setIsAddingPasskey(false);
    setPasskeyName('');
    setAddError(null);
  };

  const handleClose = () => {
    passkey.reset();
    resetAddForm();
    onClose();
  };

  /**
   * Runs the registration ceremony for the typed label, collapsing the add form on success
   */
  async function handleAddPasskey() {
    const trimmed = passkeyName.trim();
    if (!trimmed) return;

    setAddError(null);
    try {
      await passkey.registerPasskey(trimmed);
      resetAddForm();
    } catch (registrationError) {
      setAddError(getPasskeyRegistrationMessage(registrationError));
    }
  }

  return (
    <>
      <MultiFactorModalShell open={open} closeDisabled={isSecondaryOpen} onClose={handleClose}>
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          Add a second factor so a stolen password isn't enough to sign in.
        </p>

        <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4" style={{ borderBottom: '1px solid var(--app-border)' }}>
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <Smartphone size={18} aria-hidden style={{ color: 'var(--app-text-muted)' }} />
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
              One-time codes from an authenticator app when you sign in.
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

        <div className="space-y-3 py-4" style={{ borderBottom: '1px solid var(--app-border)' }}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <Fingerprint size={18} aria-hidden style={{ color: 'var(--app-text-muted)' }} />
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
            {canRegisterPasskey && !isAddingPasskey && (
              <button
                type="button"
                onClick={() => {
                  setAddError(null);
                  setIsAddingPasskey(true);
                }}
                disabled={passkey.isRegistering}
                className="app-secondary-button flex shrink-0 items-center gap-1"
              >
                <Plus size={15} aria-hidden />
                Add passkey
              </button>
            )}
          </div>

          {passkey.support && !passkey.support.supported && <WarningCallout>{passkey.support.message}</WarningCallout>}

          {isAddingPasskey && canRegisterPasskey && (
            <div className="flex items-center gap-2">
              <input
                className="app-input flex-1"
                placeholder="Name this passkey"
                value={passkeyName}
                onChange={(event) => setPasskeyName(event.target.value)}
                disabled={passkey.isRegistering}
                autoFocus
                aria-label="New passkey name"
              />
              <button
                type="button"
                onClick={handleAddPasskey}
                disabled={passkey.isRegistering || !passkeyName.trim()}
                className="app-primary-button shrink-0"
              >
                {passkey.isRegistering ? 'Waiting…' : 'Add'}
              </button>
              <button type="button" onClick={resetAddForm} disabled={passkey.isRegistering} className="app-secondary-button shrink-0">
                Cancel
              </button>
            </div>
          )}

          {addError && (
            <p className="text-xs" style={{ color: 'var(--app-negative)' }}>
              {addError}
            </p>
          )}

          {hasPasskeys && (
            <div className="divide-y overflow-hidden rounded-lg border" style={{ borderColor: 'var(--app-border)' }}>
              {passkey.passkeys.map((registeredPasskey) => (
                <PasskeyRow
                  key={registeredPasskey.id}
                  passkey={registeredPasskey}
                  onRename={(name) => passkey.renamePasskey(registeredPasskey.id, name)}
                  onRemove={() => passkey.beginRemovePasskey(registeredPasskey.id)}
                  disabled={passkey.isMutating || passkey.isRegistering}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <KeyRound size={18} aria-hidden style={{ color: 'var(--app-text-muted)' }} />
              <h4 className="text-sm font-semibold">Recovery codes</h4>
            </div>
            <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              One-time codes to get back in if you lose your authenticator and passkeys.
            </p>
          </div>
          <button
            type="button"
            onClick={totp.showRegenerate}
            disabled={!hasAnyFactor}
            className="app-secondary-button flex shrink-0 items-center gap-1"
          >
            <RefreshCw size={15} aria-hidden />
            Regenerate
          </button>
        </div>
      </MultiFactorModalShell>

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

      <RecoveryCodesModal
        open={passkey.pendingRecoveryCodes !== null}
        codes={passkey.pendingRecoveryCodes}
        description={FIRST_PASSKEY_CODES_DESCRIPTION}
        onConfirm={passkey.acknowledgeRecoveryCodes}
        onClose={passkey.dismissRecoveryCodes}
      />

      <TwoFactorModalShell open={passkey.reuseReminder} onClose={passkey.dismissReuseReminder}>
        <div className="space-y-1">
          <h3 className="text-base font-semibold">Passkey added</h3>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Your existing recovery codes also cover it, so there are no new codes to save.
          </p>
        </div>
        <button type="button" onClick={passkey.dismissReuseReminder} className="app-primary-button w-full">
          Done
        </button>
      </TwoFactorModalShell>

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
    </>
  );
}
