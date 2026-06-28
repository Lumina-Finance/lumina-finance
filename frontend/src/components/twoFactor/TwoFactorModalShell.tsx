import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

const EASE = [0.25, 0.1, 0.25, 1] as const;

interface TwoFactorModalShellProps {
  open: boolean;
  onClose: () => void;
  /** Blocks backdrop-click and Escape dismissal while an action is in flight */
  closeDisabled?: boolean;
  children: ReactNode;
}

/**
 * Shared portal, backdrop, panel, scroll lock, and close behaviour for the two-factor modals, so each
 * modal only supplies its own contents
 */
export function TwoFactorModalShell({ open, onClose, closeDisabled = false, children }: TwoFactorModalShellProps) {
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open || closeDisabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeDisabled, onClose, open]);

  /**
   * Closes on a backdrop click unless an action is in flight
   */
  const handleBackdropClick = () => {
    if (closeDisabled) return;
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="app-modal-backdrop z-50"
          onClick={handleBackdropClick}
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
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
