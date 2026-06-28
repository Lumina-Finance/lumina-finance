import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { RecoveryCodesPanel } from '@/components/twoFactor/RecoveryCodesPanel';
import { delayToMinimum } from '@/utils/timing';

const EASE = [0.25, 0.1, 0.25, 1] as const;

interface RecoveryCodesModalProps {
  open: boolean;
  codes: string[] | null;
  /** Activates the staged batch once acknowledged, the parent closes the modal on success */
  onConfirm: () => Promise<void>;
  /** Dismisses without activating, leaving the current codes in force */
  onClose: () => void;
}

/**
 * Reveals a freshly staged batch of recovery codes and only swaps them in once the user acknowledges
 * them, so closing without confirming leaves the existing codes working
 */
export function RecoveryCodesModal({ open, codes, onConfirm, onClose }: RecoveryCodesModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  /**
   * Activates the staged codes, surfacing a retryable error on failure
   */
  const handleConfirm = async () => {
    if (!acknowledged || confirming) return;

    setError('');
    setConfirming(true);
    const start = Date.now();
    try {
      await onConfirm();
      await delayToMinimum(start);
    } catch {
      await delayToMinimum(start);
      setError('Could not save your new codes. Try again.');
      setConfirming(false);
    }
  };

  /**
   * Dismisses the modal unless an activation is in flight
   */
  const handleClose = () => {
    if (confirming) return;
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {open && codes && (
        <motion.div
          className="app-modal-backdrop z-50"
          onClick={handleClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            className="app-modal-panel w-full max-w-sm space-y-5 p-6"
            onClick={(event) => event.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.25, ease: EASE }}
          >
            <div className="space-y-1">
              <h3 className="text-base font-semibold">Your new recovery codes</h3>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                These replace your current codes once you confirm. Store them somewhere safe, you won't
                see them again.
              </p>
            </div>

            <RecoveryCodesPanel codes={codes} />

            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--app-text-muted)' }}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              I've saved my new recovery codes
            </label>

            {error && (
              <p className="text-center text-sm" style={{ color: 'var(--app-negative)' }}>
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleConfirm}
              disabled={!acknowledged || confirming}
              className="app-primary-button w-full"
            >
              {confirming ? <div className="app-spinner" /> : 'Done'}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
