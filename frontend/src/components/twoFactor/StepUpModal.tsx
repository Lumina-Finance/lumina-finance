import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { OtpInput } from '@/components/OtpInput';
import { delayToMinimum } from '@/utils/timing';

const OTP_LENGTH = 6;
const EASE = [0.25, 0.1, 0.25, 1] as const;

interface StepUpModalProps {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  /** Performs the action with the entered code, rejecting on a bad code so the modal can retry */
  onVerify: (code: string) => Promise<void>;
}

/**
 * Re-verifies the second factor before a sensitive action, the OTP by default with a recovery-code
 * fallback. The parent closes the modal by flipping `open` once onVerify resolves
 */
export function StepUpModal({ open, title, description, onClose, onVerify }: StepUpModalProps) {
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [otp, setOtp] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const enteredCode = useRecoveryCode ? recoveryCode.trim() : otp;
  const canSubmit = useRecoveryCode ? enteredCode.length > 0 : otp.length === OTP_LENGTH;

  /**
   * Clears the transient inputs so the modal opens clean next time
   */
  const reset = () => {
    setUseRecoveryCode(false);
    setOtp('');
    setRecoveryCode('');
    setError('');
  };

  /**
   * Runs the action with the entered code, surfacing a retryable error on failure
   */
  const handleVerify = async () => {
    if (!canSubmit || verifying) return;

    setError('');
    setVerifying(true);
    const start = Date.now();
    try {
      await onVerify(enteredCode);
      await delayToMinimum(start);
      reset();
    } catch {
      await delayToMinimum(start);
      setError('That did not work. Check your code and try again.');
      setOtp('');
      setRecoveryCode('');
    } finally {
      setVerifying(false);
    }
  };

  /**
   * Closes the modal unless a verification is in flight
   */
  const handleClose = () => {
    if (verifying) return;
    reset();
    onClose();
  };

  /**
   * Switches between the authenticator code and a recovery code, clearing the inputs
   */
  const toggleRecoveryCode = () => {
    setUseRecoveryCode((current) => !current);
    setOtp('');
    setRecoveryCode('');
    setError('');
  };

  return createPortal(
    <AnimatePresence>
      {open && (
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
              <h3 className="text-base font-semibold">{title}</h3>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                {description}
              </p>
            </div>

            {useRecoveryCode ? (
              <input
                className="app-input w-full"
                placeholder="Recovery code"
                autoComplete="one-time-code"
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value)}
                autoFocus
              />
            ) : (
              <OtpInput value={otp} onChange={setOtp} disabled={verifying} autoFocus />
            )}

            {error && (
              <p className="text-center text-sm" style={{ color: 'var(--app-negative)' }}>
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleVerify}
              disabled={!canSubmit || verifying}
              className="app-primary-button w-full"
            >
              {verifying ? <div className="app-spinner" /> : 'Verify'}
            </button>

            <button
              type="button"
              onClick={toggleRecoveryCode}
              className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-colors duration-200"
              style={{ color: 'var(--app-accent)' }}
            >
              {useRecoveryCode ? 'Use authenticator code' : 'Enter a recovery code instead'}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
