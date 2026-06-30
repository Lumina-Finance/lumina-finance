import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { AuthenticationResponseJSON } from '@simplewebauthn/browser';
import { usePasskeyConfig, usePasskeys } from '@/api/passkeys';
import { requestPasskeyStepUpAssertion } from '@/api/passkeys/requests';
import { OtpInput, OTP_LENGTH } from '@/components/OtpInput';
import { TwoFactorModalShell } from '@/components/twoFactor/TwoFactorModalShell';
import { WarningCallout } from '@/components/twoFactor/WarningCallout';
import { useAuth } from '@/hooks/useAuth';
import { isPasskeyCeremonyCancelled } from '@/utils/passkeyErrors';
import { assessPasskeySupport } from '@/utils/passkeySupport';
import { delayToMinimum } from '@/utils/timing';

export interface StepUpCredentials {
  /** Empty when the modal does not collect a password */
  password: string;
  /** A current TOTP code, when verifying by authenticator */
  code?: string;
  /** A passkey assertion, when verifying by passkey */
  passkey?: AuthenticationResponseJSON;
}

interface StepUpModalProps {
  open: boolean;
  title: string;
  description: string;
  /** Collects the current password alongside the factor, for actions the backend re-checks it on */
  requirePassword?: boolean;
  /** Confirm button text, defaulting to a neutral verify label */
  confirmLabel?: string;
  /** Styles the confirm button as destructive, for actions like turning two-factor off */
  danger?: boolean;
  /** Offer a passkey as the step-up factor, preferred over a code when the user has a usable one */
  allowPasskey?: boolean;
  /** Show the recovery escape that signs out so a lost factor can be reset by a recovery sign-in */
  allowRecoveryReset?: boolean;
  onClose: () => void;
  /** Performs the action with the entered credentials, rejecting on a bad factor so the modal can retry */
  onVerify: (credentials: StepUpCredentials) => Promise<void>;
}

const GENERIC_STEP_UP_ERROR = 'That did not work. Check your details and try again.';

/**
 * Re-verifies a current second factor before a sensitive action. A passkey is offered first when the
 * user has one, with a TOTP code as the fallback. A recovery code is never accepted: losing every
 * factor is handled by the recovery escape, which signs out so the user resets through a recovery
 * sign-in. The parent closes the modal by flipping `open` once onVerify resolves
 */
export function StepUpModal({
  open,
  title,
  description,
  requirePassword = false,
  confirmLabel = 'Verify',
  danger = false,
  allowPasskey = false,
  allowRecoveryReset = false,
  onClose,
  onVerify,
}: StepUpModalProps) {
  const { logout } = useAuth();
  const passkeys = usePasskeys();
  const passkeyConfig = usePasskeyConfig();
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [verifyingPath, setVerifyingPath] = useState<'code' | 'passkey' | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Tracks which control is in flight so only the invoked button shows a spinner, while either path
  // disables both
  const verifying = verifyingPath !== null;

  // Only offer a passkey when the origin can run a ceremony and the user actually has one to present
  const passkeySupported = passkeyConfig.data ? assessPasskeySupport(passkeyConfig.data.rp_id).supported : false;
  const canUsePasskey = allowPasskey && passkeySupported && (passkeys.data?.length ?? 0) > 0;

  const passwordReady = !requirePassword || password.length > 0;
  const canSubmitCode = otp.length === OTP_LENGTH && passwordReady;
  const actionButtonClass = `${danger ? 'app-danger-button' : 'app-primary-button'} w-full`;

  /**
   * Clears the transient inputs so the modal opens clean next time
   */
  const reset = () => {
    setPassword('');
    setOtp('');
    setError('');
    setConfirmingReset(false);
    setResetting(false);
  };

  /**
   * Runs the supplied action with the minimum delay and shared error handling, so a failure does not
   * time how long the checks took and a cancelled passkey prompt stays silent. The path drives which
   * button shows a spinner
   */
  const runStepUp = async (path: 'code' | 'passkey', action: () => Promise<void>) => {
    setError('');
    setVerifyingPath(path);
    const start = Date.now();
    try {
      await action();
      await delayToMinimum(start);
      reset();
    } catch (stepUpError) {
      await delayToMinimum(start);
      if (!isPasskeyCeremonyCancelled(stepUpError)) setError(GENERIC_STEP_UP_ERROR);
      setOtp('');
    } finally {
      setVerifyingPath(null);
    }
  };

  /**
   * Submitting the form runs the code path. The confirm button is the form's only submit control, so a
   * password manager that autofills and auto-submits lands on the action rather than the recovery escape
   */
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmitCode || verifying) return;
    void runStepUp('code', () => onVerify({ password, code: otp }));
  };

  const handlePasskeyVerify = () => {
    if (!passwordReady || verifying) return;
    void runStepUp('passkey', async () => {
      const assertion = await requestPasskeyStepUpAssertion();
      await onVerify({ password, passkey: assertion });
    });
  };

  /**
   * Signs out so the user can reset a lost factor through a recovery sign-in, guarding against a
   * double-click while the request is in flight
   */
  const handleRecoveryReset = async () => {
    if (resetting) return;
    setResetting(true);
    try {
      await logout();
    } catch {
      setResetting(false);
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
          {confirmingReset
            ? "You'll be signed out everywhere and can set up a new factor after signing in with a recovery code."
            : description}
        </p>
      </div>

      {confirmingReset ? (
        <>
          <WarningCallout>
            This removes all your authenticators and passkeys and signs you out everywhere. You'll sign in
            with a recovery code and set up a new factor.
          </WarningCallout>
          <button type="button" onClick={handleRecoveryReset} disabled={resetting} className="app-danger-button w-full">
            {resetting ? <div className="app-spinner" /> : 'Sign out and reset'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingReset(false)}
            disabled={resetting}
            className="block w-full text-center text-sm font-medium underline underline-offset-2"
            style={{ color: 'var(--app-text-muted)' }}
          >
            Back
          </button>
        </>
      ) : (
        <>
          <form onSubmit={handleSubmit} className="space-y-5">
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

            {canUsePasskey && (
              <>
                <button
                  type="button"
                  onClick={handlePasskeyVerify}
                  disabled={!passwordReady || verifying}
                  className="app-primary-button flex w-full items-center justify-center gap-2"
                >
                  {verifyingPath === 'passkey' ? <div className="app-spinner" /> : <KeyRound size={16} aria-hidden />}
                  Verify with a passkey
                </button>
                <p className="text-center text-xs" style={{ color: 'var(--app-text-muted)' }}>
                  or enter a code from your authenticator app
                </p>
              </>
            )}

            <OtpInput value={otp} onChange={setOtp} disabled={verifying} autoFocus={!requirePassword && !canUsePasskey} />

            {error && (
              <p className="text-center text-sm" style={{ color: 'var(--app-negative)' }}>
                {error}
              </p>
            )}

            <button type="submit" disabled={!canSubmitCode || verifying} className={actionButtonClass}>
              {verifyingPath === 'code' ? <div className="app-spinner" /> : confirmLabel}
            </button>
          </form>

          {/* Outside the form so a password manager's autofill-and-submit cannot land on this destructive escape */}
          {allowRecoveryReset && (
            <button
              type="button"
              onClick={() => setConfirmingReset(true)}
              disabled={verifying}
              className="block w-full text-center text-sm font-medium underline underline-offset-2"
              style={{ color: 'var(--app-text-muted)' }}
            >
              Lost your authenticator?
            </button>
          )}
        </>
      )}
    </TwoFactorModalShell>
  );
}
