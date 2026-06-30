import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

const EASE = [0.25, 0.1, 0.25, 1] as const;

// A stack of the open modal shells so a single Escape press only closes the top-most one. Each shell
// registers its own window listener, so without this guard one press would close every stacked modal
const openModalStack: symbol[] = [];

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

    const token = Symbol('two-factor-modal');
    openModalStack.push(token);

    const onKeyDown = (event: KeyboardEvent) => {
      // Only the top-most open shell reacts, so Escape never closes a modal stacked underneath
      if (event.key === 'Escape' && openModalStack[openModalStack.length - 1] === token) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      const index = openModalStack.indexOf(token);
      if (index !== -1) openModalStack.splice(index, 1);
    };
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
          className="app-modal-backdrop z-[70]"
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
