import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { TotpEnrollment } from '@/components/twoFactor/TotpEnrollment';

const EASE = [0.25, 0.1, 0.25, 1] as const;

interface TotpEnrollmentModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Hosts the enrolment flow in a modal for turning two-factor on from settings, closing once the
 * user acknowledges their recovery codes
 */
export function TotpEnrollmentModal({ open, onClose }: TotpEnrollmentModalProps) {
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
            className="app-modal-panel w-full max-w-sm p-6"
            onClick={(event) => event.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.25, ease: EASE }}
          >
            <TotpEnrollment onComplete={onClose} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
