import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ShieldCheck, X } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

const EASE = [0.25, 0.1, 0.25, 1] as const;

interface MultiFactorModalShellProps {
  open: boolean;
  /** Blocks dismissal while a stacked step-up or codes modal is open on top */
  closeDisabled?: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Framed modal for managing every second factor, matching the create-modal chrome (accent rail,
 * eyebrow, serif title) but with a management body and a single Done action rather than a create form.
 * It sits below the secondary step-up and recovery-code modals that stack on top of it
 */
export function MultiFactorModalShell({ open, closeDisabled = false, onClose, children }: MultiFactorModalShellProps) {
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open || closeDisabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeDisabled, onClose, open]);

  const closeIfAllowed = closeDisabled ? undefined : onClose;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50"
            style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={closeIfAllowed}
            aria-hidden
          />

          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.25, ease: EASE }}
            onClick={closeIfAllowed}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="multi-factor-title"
              className="app-modal-panel flex max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-2xl"
              style={{
                background: 'var(--app-bg)',
                border: '1px solid var(--app-border-strong)',
                boxShadow: 'var(--app-shadow-soft)',
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className="hidden w-14 shrink-0 flex-col items-center justify-between py-6 sm:flex"
                style={{ background: 'var(--app-button-primary-bg)', color: 'var(--app-button-primary-text)' }}
                aria-hidden
              >
                <ShieldCheck size={20} strokeWidth={2} />
                <span className="rotate-180 text-xs font-semibold uppercase" style={{ writingMode: 'vertical-rl' }}>
                  Security
                </span>
              </div>

              <div className="flex min-h-0 w-full flex-col">
                <div className="shrink-0 px-6 pb-5 pt-6 sm:pt-7" style={{ borderBottom: '1px solid var(--app-border)' }}>
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                        Account protection
                      </p>
                      <h3 id="multi-factor-title" className="font-serif text-3xl font-light">
                        Multi-factor authentication
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={onClose}
                      className="app-icon-button shrink-0"
                      disabled={closeDisabled}
                      aria-label="Close"
                    >
                      <X size={20} aria-hidden />
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>

                <div className="flex shrink-0 justify-end px-6 py-4" style={{ borderTop: '1px solid var(--app-border)' }}>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={closeDisabled}
                    className="app-primary-button w-full sm:w-auto"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
