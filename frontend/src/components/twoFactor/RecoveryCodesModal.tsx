import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { RecoveryCodesPanel } from '@/components/twoFactor/RecoveryCodesPanel';

const EASE = [0.25, 0.1, 0.25, 1] as const;

interface RecoveryCodesModalProps {
  open: boolean;
  codes: string[] | null;
  onClose: () => void;
}

/**
 * Reveals a freshly regenerated batch of recovery codes once, replacing whatever the user had before
 */
export function RecoveryCodesModal({ open, codes, onClose }: RecoveryCodesModalProps) {
  return createPortal(
    <AnimatePresence>
      {open && codes && (
        <motion.div
          className="app-modal-backdrop z-50"
          onClick={onClose}
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
                These replace your previous codes. Store them somewhere safe, you won't see them again.
              </p>
            </div>

            <RecoveryCodesPanel codes={codes} />

            <button type="button" onClick={onClose} className="app-primary-button w-full">
              Done
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
