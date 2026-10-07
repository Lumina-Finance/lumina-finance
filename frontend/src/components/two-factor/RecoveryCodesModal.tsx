import { useState } from 'react';
import { RecoveryCodesPanel, type RecoveryFactors } from '@/components/two-factor/RecoveryCodesPanel';
import { SetupRestart } from '@/components/two-factor/SetupRestart';
import { ModalContentPanel } from '@/components/modal/ContentPanel';
import type { ModalLevel } from '@/components/modal/Shell';
import { delayToMinimum } from '@/utils/timing';

const DEFAULT_DESCRIPTION =
  "These replace your current codes once you confirm. Store them somewhere safe, you won't see them again.";

type RecoveryCodesModalProps = {
  open: boolean;
  codes: string[] | null;
  /** The factors this batch covers, named in the lockout warning */
  factors: RecoveryFactors;
  /** Activates the staged batch once acknowledged, the parent closes the modal on success */
  onConfirm: () => Promise<void>;
  /** Dismisses without activating, leaving the current codes in force */
  onClose: () => void;
  /** Drops this batch and begins the step that issued it again, since a failed confirm can't be retried */
  onRestart: () => void;
  /** Overrides the body text, since first-time issuance reads differently from a rotation */
  description?: string;
  /** Set to stacked where this opens over the multi-factor modal rather than straight from a page */
  level?: ModalLevel;
};

/**
 * Reveals a freshly staged batch of recovery codes and only swaps them in once the user acknowledges
 * them, so closing without confirming leaves the existing codes working
 */
export function RecoveryCodesModal({
  open,
  codes,
  factors,
  onConfirm,
  onClose,
  onRestart,
  description = DEFAULT_DESCRIPTION,
  level = 'page',
}: RecoveryCodesModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [lockoutAcknowledged, setLockoutAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  const ready = acknowledged && lockoutAcknowledged;

  // The component stays mounted between rotations, so reset transient state on each close
  const reset = () => {
    setAcknowledged(false);
    setLockoutAcknowledged(false);
    setConfirming(false);
    setFailed(false);
  };

  /**
   * Activates the staged codes, offering a fresh start on failure
   */
  const handleConfirm = async () => {
    if (!ready || confirming) return;

    setConfirming(true);
    const start = Date.now();
    try {
      await onConfirm();
      await delayToMinimum(start);
      reset();
    } catch {
      await delayToMinimum(start);
      setFailed(true);
      setConfirming(false);
    }
  };

  /**
   * Resets the transient state as the modal closes
   */
  const handleClose = () => {
    reset();
    onClose();
  };

  /**
   * Resets the transient state and hands back to the parent to issue a new batch
   */
  const handleStartAgain = () => {
    reset();
    onRestart();
  };

  return (
    <ModalContentPanel open={open} onClose={handleClose} closeDisabled={confirming} titleId="recovery-codes-title" level={level}>
      <div className="space-y-1">
        <h3 id="recovery-codes-title" className="text-base font-semibold">Your new recovery codes</h3>
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          {description}
        </p>
      </div>

      {codes && <RecoveryCodesPanel codes={codes} factors={factors} />}

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--app-text-muted)' }}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          I've saved my new recovery codes
        </label>

        <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--app-text-muted)' }}>
          <input
            type="checkbox"
            className="mt-0.5 shrink-0"
            checked={lockoutAcknowledged}
            onChange={(event) => setLockoutAcknowledged(event.target.checked)}
          />
          <span>
            I understand that losing my recovery codes and my passkey or authenticator at the same time
            may permanently lock me out of my account
          </span>
        </label>
      </div>

      {failed ? (
        <SetupRestart onStartAgain={handleStartAgain} />
      ) : (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!ready || confirming}
            className={`app-primary-button transition-all duration-300 ${confirming ? 'app-primary-button-loading' : 'w-full'}`}
          >
            {confirming ? <div className="app-spinner" /> : 'Done'}
          </button>
        </div>
      )}
    </ModalContentPanel>
  );
}
