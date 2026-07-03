import { useState } from 'react';
import { RecoveryCodesPanel } from '@/components/twoFactor/RecoveryCodesPanel';
import { TwoFactorModalShell } from '@/components/twoFactor/TwoFactorModalShell';
import { delayToMinimum } from '@/utils/timing';

const DEFAULT_DESCRIPTION =
  "These replace your current codes once you confirm. Store them somewhere safe, you won't see them again.";

interface RecoveryCodesModalProps {
  open: boolean;
  codes: string[] | null;
  /** Activates the staged batch once acknowledged, the parent closes the modal on success */
  onConfirm: () => Promise<void>;
  /** Dismisses without activating, leaving the current codes in force */
  onClose: () => void;
  /** Overrides the body copy, since first-time issuance reads differently from a rotation */
  description?: string;
}

/**
 * Reveals a freshly staged batch of recovery codes and only swaps them in once the user acknowledges
 * them, so closing without confirming leaves the existing codes working
 */
export function RecoveryCodesModal({
  open,
  codes,
  onConfirm,
  onClose,
  description = DEFAULT_DESCRIPTION,
}: RecoveryCodesModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [lockoutAcknowledged, setLockoutAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  const ready = acknowledged && lockoutAcknowledged;

  // The component stays mounted between rotations, so reset transient state on each close
  const reset = () => {
    setAcknowledged(false);
    setLockoutAcknowledged(false);
    setConfirming(false);
    setError('');
  };

  /**
   * Activates the staged codes, surfacing a retryable error on failure
   */
  const handleConfirm = async () => {
    if (!ready || confirming) return;

    setError('');
    setConfirming(true);
    const start = Date.now();
    try {
      await onConfirm();
      await delayToMinimum(start);
      reset();
    } catch {
      await delayToMinimum(start);
      setError('Could not save your new codes. Try again.');
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

  return (
    <TwoFactorModalShell open={open} onClose={handleClose} closeDisabled={confirming}>
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Your new recovery codes</h3>
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          {description}
        </p>
      </div>

      {codes && <RecoveryCodesPanel codes={codes} />}

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

      {error && (
        <p className="text-center text-sm" style={{ color: 'var(--app-negative)' }}>
          {error}
        </p>
      )}

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
    </TwoFactorModalShell>
  );
}
