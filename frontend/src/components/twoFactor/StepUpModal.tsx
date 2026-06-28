import { useState } from 'react';
import { OtpInput, OTP_LENGTH } from '@/components/OtpInput';
import { TwoFactorModalShell } from '@/components/twoFactor/TwoFactorModalShell';
import { delayToMinimum } from '@/utils/timing';

export interface StepUpCredentials {
  /** Empty when the modal does not collect a password */
  password: string;
  /** A current TOTP code */
  code: string;
}

interface StepUpModalProps {
  open: boolean;
  title: string;
  description: string;
  /** Collects the current password alongside the code, for actions the backend re-checks it on */
  requirePassword?: boolean;
  /** Confirm button text, defaulting to a neutral verify label */
  confirmLabel?: string;
  /** Styles the confirm button as destructive, for actions like turning two-factor off */
  danger?: boolean;
  onClose: () => void;
  /** Performs the action with the entered credentials, rejecting on a bad code so the modal can retry */
  onVerify: (credentials: StepUpCredentials) => Promise<void>;
}

/**
 * Re-verifies the authenticator before a sensitive action. Only a TOTP code is accepted, never a
 * recovery code, since recovery codes are a login-only break-glass. The parent closes the modal by
 * flipping `open` once onVerify resolves
 */
export function StepUpModal({
  open,
  title,
  description,
  requirePassword = false,
  confirmLabel = 'Verify',
  danger = false,
  onClose,
  onVerify,
}: StepUpModalProps) {
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const canSubmit = otp.length === OTP_LENGTH && (!requirePassword || password.length > 0);

  /**
   * Clears the transient inputs so the modal opens clean next time
   */
  const reset = () => {
    setPassword('');
    setOtp('');
    setError('');
  };

  /**
   * Runs the action with the entered credentials, surfacing a retryable error on failure
   */
  const handleVerify = async () => {
    if (!canSubmit || verifying) return;

    setError('');
    setVerifying(true);
    const start = Date.now();
    try {
      await onVerify({ password, code: otp });
      await delayToMinimum(start);
      reset();
    } catch {
      await delayToMinimum(start);
      setError('That did not work. Check your details and try again.');
      setOtp('');
    } finally {
      setVerifying(false);
    }
  };

  /**
   * Resets the inputs as the modal closes
   */
  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <TwoFactorModalShell open={open} onClose={handleClose} closeDisabled={verifying}>
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          {description}
        </p>
      </div>

      {requirePassword && (
        <input
          className="app-input w-full"
          type="password"
          placeholder="Current password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
        />
      )}

      <OtpInput value={otp} onChange={setOtp} disabled={verifying} autoFocus={!requirePassword} />

      {error && (
        <p className="text-center text-sm" style={{ color: 'var(--app-negative)' }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleVerify}
        disabled={!canSubmit || verifying}
        className={`${danger ? 'app-danger-button' : 'app-primary-button'} w-full`}
      >
        {verifying ? <div className="app-spinner" /> : confirmLabel}
      </button>
    </TwoFactorModalShell>
  );
}
