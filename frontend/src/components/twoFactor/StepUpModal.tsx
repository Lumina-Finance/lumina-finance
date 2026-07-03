import { KeyRound } from 'lucide-react';
import { useState, type FormEvent, type MouseEvent } from 'react';
import type { AuthenticationResponseJSON } from '@simplewebauthn/browser';
import { usePasskeyConfig, usePasskeys } from '@/api/passkeys';
import { requestPasskeyStepUpAssertion } from '@/api/passkeys/requests';
import { useTotpStatus } from '@/api/twoFactor';
import { OtpInput, OTP_LENGTH } from '@/components/OtpInput';
import { StepTransition } from '@/components/twoFactor/StepTransition';
import { TwoFactorModalShell } from '@/components/twoFactor/TwoFactorModalShell';
import { WarningCallout } from '@/components/twoFactor/WarningCallout';
import { useAuth } from '@/hooks/useAuth';
import { buildLockoutWarning, getAttemptsRemaining } from '@/utils/lockoutWarning';
import { isPasskeyCeremonyCancelled } from '@/utils/passkeyErrors';
import { assessPasskeySupport } from '@/utils/passkeySupport';
import { markRecoveryIntent } from '@/utils/recoveryIntent';
import { delayToMinimum, MFA_LOADING_MIN_MS } from '@/utils/timing';

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
  /** Collects the current password on a first step, for actions the backend re-checks it on */
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
 * Wraps a click action so a password manager cannot drive the prompt. 1Password and similar
 * auto-submit by calling element.click(), which dispatches an untrusted event, so only a real user
 * press should advance, confirm, leave, or reset a step-up
 */
const onUserPress = (action: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
  if (event.isTrusted) action();
};

/**
 * Re-verifies a current second factor before a sensitive action across two steps: the password first,
 * then the factor. The split gives a just-used authenticator code time to roll over so it is not
 * rejected as a replay. A passkey is offered first when the user has one, with a TOTP code as the
 * fallback. A recovery code is never accepted: losing every factor is handled by the recovery escape,
 * which signs out so the user resets through a recovery sign-in. The parent closes the modal by
 * flipping `open` once onVerify resolves
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
  const totpStatus = useTotpStatus();
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  // Holds the attempts left before the lockout after a failed try, shown as a callout so the user is
  // warned before the entry that signs them out everywhere
  const [lockoutRemaining, setLockoutRemaining] = useState<number | null>(null);
  const [verifyingPath, setVerifyingPath] = useState<'code' | 'passkey' | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [step, setStep] = useState<'password' | 'factor'>(requirePassword ? 'password' : 'factor');

  // Tracks which control is in flight so only the invoked button shows a spinner, while either path
  // disables both
  const verifying = verifyingPath !== null;

  // Only offer a passkey when the origin can run a ceremony and the user actually has one to present
  const passkeySupported = passkeyConfig.data ? assessPasskeySupport(passkeyConfig.data.rp_id).supported : false;
  const canUsePasskey = allowPasskey && passkeySupported && (passkeys.data?.length ?? 0) > 0;

  // Show the authenticator code path unless a passkey is the only usable factor, so a passkey-only or
  // a TOTP-only account is offered just its own option
  const totpEnabled = totpStatus.data?.totp_enabled ?? false;
  const showCodeEntry = totpEnabled || !canUsePasskey;

  // Adding a first factor has nothing to present, so once the factor queries resolve with none the
  // password alone authorizes it and the modal skips the factor step entirely
  const factorsResolved = !passkeys.isLoading && !totpStatus.isLoading;
  const hasFactor = (passkeys.data?.length ?? 0) > 0 || totpEnabled;
  const passwordOnly = requirePassword && factorsResolved && !hasFactor;
  const canSubmitCode = otp.length === OTP_LENGTH;
  // Shrink the confirm control to a spinner circle while its own path verifies, matching the app's
  // other loading buttons
  const actionButtonClass = `${danger ? 'app-danger-button' : 'app-primary-button'} transition-all duration-300 ${verifyingPath === 'code' ? 'app-primary-button-loading' : 'w-full'}`;

  /**
   * Clears the transient inputs so the modal opens clean next time
   */
  const reset = () => {
    setPassword('');
    setOtp('');
    setError('');
    setLockoutRemaining(null);
    setConfirmingReset(false);
    setRecoveryAcknowledged(false);
    setResetting(false);
    setStep(requirePassword ? 'password' : 'factor');
  };

  /**
   * Runs the supplied action with the minimum delay and shared error handling, so a failure does not
   * time how long the checks took and a cancelled passkey prompt stays silent. The path drives which
   * button shows a spinner
   */
  const runStepUp = async (path: 'code' | 'passkey', action: () => Promise<void>) => {
    setError('');
    setLockoutRemaining(null);
    setVerifyingPath(path);
    const start = Date.now();
    try {
      await action();
      await delayToMinimum(start, MFA_LOADING_MIN_MS);
      reset();
    } catch (stepUpError) {
      await delayToMinimum(start, MFA_LOADING_MIN_MS);
      // A step-up 401 reports the remaining allowance, which supersedes the generic error so the user
      // sees the lockout countdown rather than a bare failure
      const remaining = getAttemptsRemaining(stepUpError);
      if (remaining !== null) {
        setLockoutRemaining(remaining);
      } else if (!isPasskeyCeremonyCancelled(stepUpError)) {
        setError(GENERIC_STEP_UP_ERROR);
      }
      setOtp('');
    } finally {
      setVerifyingPath(null);
    }
  };

  /**
   * Advances from the password step to the factor step. The action itself only runs once the factor is
   * verified, so a wrong password surfaces there rather than here
   */
  const handleContinue = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Password managers auto-submit by calling click(), which fires an untrusted event, so the prompt
    // only advances on a real user press
    if (!event.isTrusted) return;
    if (!password) return;
    setError('');

    // With no factor to present the password alone completes the action, so a wrong password surfaces
    // here rather than on a factor step that would never appear
    if (passwordOnly) {
      void runStepUp('code', () => onVerify({ password }));
      return;
    }
    setStep('factor');
  };

  /**
   * Submitting the factor form confirms the action. A password manager that autofills and auto-submits
   * fires an untrusted event, which is ignored so the confirm only runs on a real user press
   */
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.isTrusted) return;
    if (!canSubmitCode || verifying) return;
    void runStepUp('code', () => onVerify({ password, code: otp }));
  };

  const handlePasskeyVerify = (event: MouseEvent<HTMLButtonElement>) => {
    // A password manager auto-clicking this fires an untrusted event, which must not launch a ceremony
    if (!event.isTrusted || verifying) return;
    void runStepUp('passkey', async () => {
      const assertion = await requestPasskeyStepUpAssertion();
      await onVerify({ password, passkey: assertion });
    });
  };

  /**
   * Signs out so the user can reset a lost factor through a recovery sign-in, guarding against a
   * double-click while the request is in flight
   */
  const handleRecoveryReset = async (event: MouseEvent<HTMLButtonElement>) => {
    // A password manager auto-clicking this fires an untrusted event, which must not sign the user out
    if (!event.isTrusted || resetting) return;
    setResetting(true);
    const start = Date.now();
    try {
      // Flag the recovery intent so the login page opens in recovery mode once the session ends
      markRecoveryIntent();
      // Hold the spinner for the shared minimum so the action does not flash before the sign-out
      await delayToMinimum(start, MFA_LOADING_MIN_MS);
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

  // A lockout countdown outranks the generic error, so a near-lockout warning is never hidden behind it
  const feedback =
    lockoutRemaining !== null ? (
      <WarningCallout>{buildLockoutWarning(lockoutRemaining)}</WarningCallout>
    ) : error ? (
      <p className="text-center text-sm" style={{ color: 'var(--app-negative)' }}>
        {error}
      </p>
    ) : null;

  return (
    <TwoFactorModalShell open={open} onClose={handleClose} closeDisabled={verifying || resetting}>
      <StepTransition
        stepKey={confirmingReset ? 'reset' : step}
        header={
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{title}</h3>
            <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              {confirmingReset
                ? "You'll be signed out everywhere and can set up a new factor after signing in with a recovery code."
                : description}
            </p>
          </div>
        }
      >
        {confirmingReset ? (
          <div className="space-y-5">
            <WarningCallout>
              This removes all your authenticators and passkeys and signs you out everywhere. You'll sign back
              in with a recovery code, then set up a new factor.
            </WarningCallout>
            <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--app-text-muted)' }}>
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={recoveryAcknowledged}
                onChange={(event) => setRecoveryAcknowledged(event.target.checked)}
                disabled={resetting}
              />
              <span>I have a recovery code and understand I'll need one to sign back in</span>
            </label>
            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleRecoveryReset}
                disabled={resetting || !recoveryAcknowledged}
                className={`app-danger-button transition-all duration-300 ${resetting ? 'app-primary-button-loading' : 'w-full'}`}
              >
                {resetting ? <div className="app-spinner" /> : 'Sign out to recover'}
              </button>
            </div>
            <button
              type="button"
              onClick={onUserPress(() => setConfirmingReset(false))}
              disabled={resetting}
              className="block w-full text-center text-sm font-medium underline underline-offset-2"
              style={{ color: 'var(--app-text-muted)' }}
            >
              Back
            </button>
          </div>
        ) : step === 'password' ? (
          <form onSubmit={handleContinue} className="space-y-5">
            <input
              className="app-input w-full"
              type="password"
              placeholder="Current password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
            />
            {passwordOnly && feedback}
            {passwordOnly ? (
              <div className="flex justify-center">
                <button
                  type="submit"
                  disabled={!password || verifying}
                  className={`${danger ? 'app-danger-button' : 'app-primary-button'} transition-all duration-300 ${verifyingPath === 'code' ? 'app-primary-button-loading' : 'w-full'}`}
                >
                  {verifyingPath === 'code' ? <div className="app-spinner" /> : confirmLabel}
                </button>
              </div>
            ) : (
              <button type="submit" disabled={!password} className="app-primary-button w-full">
                Continue
              </button>
            )}
          </form>
        ) : (
          <div className="space-y-5">
            <form onSubmit={handleSubmit} className="space-y-5">
              {canUsePasskey && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={handlePasskeyVerify}
                    disabled={verifying}
                    className={`app-primary-button transition-all duration-300 ${verifyingPath === 'passkey' ? 'app-primary-button-loading' : 'flex w-full items-center justify-center gap-2'}`}
                  >
                    {verifyingPath === 'passkey' ? (
                      <div className="app-spinner" />
                    ) : (
                      <>
                        <KeyRound size={16} aria-hidden />
                        Verify with a passkey
                      </>
                    )}
                  </button>
                </div>
              )}

              {canUsePasskey && showCodeEntry && (
                <p className="text-center text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  or enter a code from your authenticator app
                </p>
              )}

              {showCodeEntry && (
                <OtpInput value={otp} onChange={setOtp} disabled={verifying} autoFocus={!canUsePasskey} />
              )}

              {feedback}

              {showCodeEntry && (
                <div className="flex justify-center">
                  <button type="submit" disabled={!canSubmitCode || verifying} className={actionButtonClass}>
                    {verifyingPath === 'code' ? <div className="app-spinner" /> : confirmLabel}
                  </button>
                </div>
              )}
            </form>

            {/* Links sit outside the form so a password manager's autofill-and-submit cannot land on them */}
            {requirePassword && (
              <button
                type="button"
                onClick={onUserPress(() => {
                  // Drop the entered password when stepping back so it is not held while the user is away
                  setStep('password');
                  setPassword('');
                  setOtp('');
                  setError('');
                })}
                disabled={verifying}
                className="block w-full text-center text-sm underline underline-offset-2"
                style={{ color: 'var(--app-text-muted)' }}
              >
                Back
              </button>
            )}
            {allowRecoveryReset && (
              <button
                type="button"
                onClick={onUserPress(() => setConfirmingReset(true))}
                disabled={verifying}
                className="block w-full text-center text-sm font-medium underline underline-offset-2"
                style={{ color: 'var(--app-text-muted)' }}
              >
                Lost your authenticator?
              </button>
            )}
          </div>
        )}
      </StepTransition>
    </TwoFactorModalShell>
  );
}
