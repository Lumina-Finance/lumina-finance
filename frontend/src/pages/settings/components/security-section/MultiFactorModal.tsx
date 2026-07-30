import { useState } from 'react';
import { Fingerprint, KeyRound, Plus, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { PasskeyRow } from '@/components/passkeys/PasskeyRow';
import { ModalContentPanel } from '@/components/modal/ContentPanel';
import { ModalTitledPanel } from '@/components/modal/TitledPanel';
import { RecoveryCodesModal } from '@/components/two-factor/RecoveryCodesModal';
import { StepUpModal, type StepUpCredentials } from '@/components/two-factor/StepUpModal';
import { TotpEnrollmentModal } from '@/components/two-factor/TotpEnrollmentModal';
import { WarningCallout } from '@/components/two-factor/WarningCallout';
import { usePasskeyManagement } from '@/pages/settings/hooks/usePasskeyManagement';
import { useTwoFactorManagement } from '@/pages/settings/hooks/useTwoFactorManagement';
import { ApiError } from '@/api/auth';
import { setupTotp, type TotpSetupResponse } from '@/api/two-factor';
import { getPasskeyRegistrationMessage } from '@/utils/passkeyErrors';

// Grow and fade a passkey row so it eases into the list instead of snapping, with the modal height
// following the real height change
const LIST_ITEM_TRANSITION = { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const };

const LIST_ITEM_MOTION = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' as const },
  exit: { opacity: 0, height: 0 },
  transition: LIST_ITEM_TRANSITION,
};

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
  const [pendingPasskeyName, setPendingPasskeyName] = useState<string | null>(null);
  const [isTotpEnableStepUpOpen, setIsTotpEnableStepUpOpen] = useState(false);
  const [totpSetup, setTotpSetup] = useState<TotpSetupResponse | null>(null);

  const hasPasskeys = passkey.passkeys.length > 0;
  const hasAnyFactor = totp.isEnabled || hasPasskeys;
  const canRegisterPasskey = passkey.support?.supported === true;

  const isSecondaryOpen =
    totp.openModal !== 'none' ||
    totp.regeneratedCodes !== null ||
    passkey.pendingRecoveryCodes !== null ||
    passkey.reuseReminder ||
    passkey.isRemovalOpen ||
    pendingPasskeyName !== null ||
    isTotpEnableStepUpOpen;

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
   * Opens the step-up prompt for the typed label, since adding a passkey now reauthorizes first
   */
  function handleAddPasskey() {
    const trimmed = passkeyName.trim();
    if (!trimmed) return;

    setAddError(null);
    setPendingPasskeyName(trimmed);
  }

  /**
   * Runs the registration ceremony once the step-up succeeds, forwarding the reauthorization so the
   * backend accepts the new passkey. A failure surfaces on the add form after the prompt closes
   */
  async function confirmAddPasskey(credentials: StepUpCredentials) {
    if (!pendingPasskeyName) return;

    try {
      await passkey.registerPasskey(pendingPasskeyName, credentials);
      setPendingPasskeyName(null);
      resetAddForm();
    } catch (registrationError) {
      // A failed step-up rejects so the prompt shows it and stays open to retry, while a ceremony or
      // attestation failure, which happens only after step-up cleared, closes it onto the add form
      if (registrationError instanceof ApiError && registrationError.status === 401) throw registrationError;
      setPendingPasskeyName(null);
      setAddError(getPasskeyRegistrationMessage(registrationError));
    }
  }

  /**
   * Mints the enrolment secret once the enable step-up succeeds, then opens enrolment showing it. A
   * failed step-up rejects so its prompt shows the error and stays open, with no QR behind it yet
   */
  async function confirmTotpEnable(credentials: StepUpCredentials) {
    const setup = await setupTotp(credentials);
    setTotpSetup(setup);
    setIsTotpEnableStepUpOpen(false);
    totp.showEnable();
  }

  return (
    <>
      <ModalTitledPanel
        open={open}
        onClose={handleClose}
        closeDisabled={isSecondaryOpen}
        titleId="multi-factor-title"
        title="Multi-factor authentication"
        eyebrow="Account protection"
        RailIcon={ShieldCheck}
        railLabel="Security"
        footer={
          <div className="flex shrink-0 justify-end px-6 py-4" style={{ borderTop: '1px solid var(--app-border)' }}>
            <button
              type="button"
              onClick={handleClose}
              disabled={isSecondaryOpen}
              className="app-primary-button w-full sm:w-auto"
            >
              Done
            </button>
          </div>
        }
      >
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
            <button type="button" onClick={() => setIsTotpEnableStepUpOpen(true)} disabled={totp.isStatusLoading} className="app-secondary-button shrink-0">
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

          <AnimatePresence initial={false}>
            {isAddingPasskey && canRegisterPasskey && (
              <motion.div key="add-passkey-form" style={{ overflow: 'hidden' }} {...LIST_ITEM_MOTION}>
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
              </motion.div>
            )}
          </AnimatePresence>

          {addError && (
            <p className="text-xs" style={{ color: 'var(--app-negative)' }}>
              {addError}
            </p>
          )}

          <AnimatePresence initial={false}>
            {hasPasskeys && (
              <motion.div key="passkey-list" className="space-y-2 overflow-hidden" {...LIST_ITEM_MOTION}>
                <AnimatePresence initial={false}>
                  {passkey.passkeys.map((registeredPasskey) => (
                    <motion.div key={registeredPasskey.id} style={{ overflow: 'hidden' }} {...LIST_ITEM_MOTION}>
                      <PasskeyRow
                        passkey={registeredPasskey}
                        onRename={(name) => passkey.renamePasskey(registeredPasskey.id, name)}
                        onRemove={() => passkey.beginRemovePasskey(registeredPasskey.id)}
                        disabled={passkey.isMutating || passkey.isRegistering}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
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
      </ModalTitledPanel>

      <TotpEnrollmentModal
        open={totp.openModal === 'enable'}
        initialSetup={totpSetup ?? undefined}
        onClose={() => {
          totp.closeModal();
          setTotpSetup(null);
        }}
      />

      <StepUpModal
        level="stacked"
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
        level="stacked"
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
        level="stacked"
        open={totp.regeneratedCodes !== null}
        codes={totp.regeneratedCodes}
        onConfirm={totp.acknowledgeRegeneratedCodes}
        onClose={totp.dismissRegeneratedCodes}
      />

      <RecoveryCodesModal
        level="stacked"
        open={passkey.pendingRecoveryCodes !== null}
        codes={passkey.pendingRecoveryCodes}
        description={FIRST_PASSKEY_CODES_DESCRIPTION}
        onConfirm={passkey.acknowledgeRecoveryCodes}
        onClose={passkey.dismissRecoveryCodes}
      />

      <ModalContentPanel open={passkey.reuseReminder} onClose={passkey.dismissReuseReminder} titleId="passkey-added-title" level="stacked">
        <div className="space-y-1">
          <h3 id="passkey-added-title" className="text-base font-semibold">Passkey added</h3>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Your existing recovery codes also cover it, so there are no new codes to save.
          </p>
        </div>
        <button type="button" onClick={passkey.dismissReuseReminder} className="app-primary-button w-full">
          Done
        </button>
      </ModalContentPanel>

      <StepUpModal
        level="stacked"
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

      <StepUpModal
        level="stacked"
        open={isTotpEnableStepUpOpen}
        title="Turn on two-factor authentication"
        description="Confirm it's you to turn two-factor on."
        requirePassword
        confirmLabel="Continue"
        allowPasskey
        onClose={() => setIsTotpEnableStepUpOpen(false)}
        onVerify={confirmTotpEnable}
      />

      <StepUpModal
        level="stacked"
        open={pendingPasskeyName !== null}
        title="Add a passkey"
        description="Confirm it's you before adding a passkey."
        requirePassword
        confirmLabel="Add passkey"
        allowPasskey
        onClose={() => setPendingPasskeyName(null)}
        onVerify={confirmAddPasskey}
      />
    </>
  );
}
