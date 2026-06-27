import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';

const EASE = [0.25, 0.1, 0.25, 1] as const;

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
  return createPortal(
    <AnimatePresence>
      {open && (
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
