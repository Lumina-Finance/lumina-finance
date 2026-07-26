import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useCompleteTotp, useConfirmTotp, useSetupTotp } from '@/api/two-factor';
import type { RecoveryCodesResponse, StepUpPayload, TotpSetupResponse } from '@/api/two-factor/types';
import { OtpInput, OTP_LENGTH } from '@/components/OtpInput';
import { RecoveryCodesPanel } from '@/components/two-factor/RecoveryCodesPanel';
import { StepTransition } from '@/components/two-factor/StepTransition';
import { copyText } from '@/utils/clipboard';
import { delayToMinimum, MFA_LOADING_MIN_MS } from '@/utils/timing';

// How long the copied confirmation stays before reverting to the copy affordance
const COPIED_FEEDBACK_MS = 1500;

// Hold the QR and key behind the spinner this long so a fast secret does not flash in
const SETUP_LOADING_MIN_MS = 800;

interface TotpEnrollmentProps {
  /** Called once 2FA is confirmed and the recovery codes are acknowledged */
  onComplete: () => void;
  /** Optional skip affordance, shown during signup but not in settings */
  onSkip?: () => void;
  /** Optional switch back to passkey enrolment, shown at signup when the origin supports passkeys */
  onSwitchToPasskey?: () => void;
  /**
   * A secret already minted after stepping up, used in settings where the step-up prompt ran and
   * fetched it before opening enrolment. When set, enrolment does not mint its own
   */
  initialSetup?: TotpSetupResponse;
  /**
   * Password-only reauthorization for minting the secret, used at signup where the just-set password
   * gates the account's first factor. Omitted for a forced re-enrolment
   */
  setupStepUp?: StepUpPayload;
}

/**
 * Drives the shared TOTP enrolment flow: the QR and code confirmation, then the one-time recovery codes
 */
export function TotpEnrollment({ onComplete, onSkip, onSwitchToPasskey, initialSetup, setupStepUp }: TotpEnrollmentProps) {
  // Settings supplies a secret it already stepped up for, so this only mints one for signup and re-enrol
  const setup = useSetupTotp({ enabled: !initialSetup, stepUp: setupStepUp });
  const setupData = initialSetup ?? setup.data;
  const confirm = useConfirmTotp();
  const complete = useCompleteTotp();
  const [minLoadingElapsed, setMinLoadingElapsed] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [enabledViaReuse, setEnabledViaReuse] = useState(false);
  const [savedAcknowledged, setSavedAcknowledged] = useState(false);
  const [lockoutAcknowledged, setLockoutAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const copyResetTimer = useRef<number | null>(null);

  // Hold the spinner for a fixed minimum from mount so a fast secret does not flash the QR in
  useEffect(() => {
    const timer = window.setTimeout(() => setMinLoadingElapsed(true), SETUP_LOADING_MIN_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // A pending copy timer would fire setState after the modal closes, so it is cleared on unmount
  useEffect(() => {
    return () => {
      if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current);
    };
  }, []);

  // The spinner stays until both the minimum has elapsed and the secret has resolved
  const isSetupLoading = !minLoadingElapsed || (!setupData && !setup.isError);

  /**
   * Copies the secret to the clipboard and briefly confirms it so the user need not select the text
   */
  const copyKey = async () => {
    if (!setupData || !(await copyText(setupData.secret))) return;

    setKeyCopied(true);
    if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current);
    copyResetTimer.current = window.setTimeout(() => setKeyCopied(false), COPIED_FEEDBACK_MS);
  };

  /**
   * Reveals the recovery codes to save, or notes two-factor turned on directly when a batch already
   * existed so there is nothing to acknowledge
   */
  const applyConfirmResult = (result: RecoveryCodesResponse) => {
    if (result.recovery_codes.length > 0) {
      setRecoveryCodes(result.recovery_codes);
    } else {
      setEnabledViaReuse(true);
    }
  };

  /**
   * Confirms the entered code, revealing the recovery codes on success and allowing a retry on failure
   * The step-up already ran when the secret was minted, so confirm carries only the code
   */
  const handleConfirm = async () => {
    if (code.length < OTP_LENGTH || confirming) return;

    setError('');
    setConfirming(true);
    const start = Date.now();
    try {
      const result = await confirm.mutateAsync({ code });
      await delayToMinimum(start, MFA_LOADING_MIN_MS);
      applyConfirmResult(result);
    } catch {
      await delayToMinimum(start, MFA_LOADING_MIN_MS);
      setError('That code was incorrect. Try again.');
      setCode('');
    } finally {
      setConfirming(false);
    }
  };

  /**
   * Turns two-factor on once the recovery codes are acknowledged, then hands back to the caller
   */
  const handleComplete = async () => {
    if (!savedAcknowledged || !lockoutAcknowledged || completing) return;

    setError('');
    setCompleting(true);
    const start = Date.now();
    try {
      await complete.mutateAsync();
      await delayToMinimum(start, MFA_LOADING_MIN_MS);
      onComplete();
    } catch {
      await delayToMinimum(start, MFA_LOADING_MIN_MS);
      setError('Could not finish setup. Try again.');
      setCompleting(false);
    }
  };

  const stepKey = enabledViaReuse ? 'reuse-done' : recoveryCodes ? 'recovery-codes' : 'totp-confirm';

  return (
    <StepTransition stepKey={stepKey}>
      {enabledViaReuse ? (
        <div className="space-y-5">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Two-factor is on</h3>
            <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              Your existing recovery codes also cover your authenticator, so there are no new codes to save.
            </p>
          </div>

          <button type="button" onClick={onComplete} className="app-primary-button w-full">
            Done
          </button>
        </div>
      ) : recoveryCodes ? (
        <div className="space-y-5">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Save your recovery codes</h3>
            <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              Each code works once if you lose your authenticator. Store them somewhere safe, you won't see them again.
            </p>
          </div>

          <RecoveryCodesPanel codes={recoveryCodes} />

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--app-text-muted)' }}>
              <input
                type="checkbox"
                checked={savedAcknowledged}
                onChange={(event) => setSavedAcknowledged(event.target.checked)}
              />
              I've saved my recovery codes
            </label>

            <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--app-text-muted)' }}>
              <input
                type="checkbox"
                className="mt-1 shrink-0"
                checked={lockoutAcknowledged}
                onChange={(event) => setLockoutAcknowledged(event.target.checked)}
              />
              I understand I may be permanently locked out if I lose both my authenticator and these codes
            </label>
          </div>

          {error && (
            <p className="text-center text-sm" style={{ color: 'var(--app-negative)' }}>
              {error}
            </p>
          )}

          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleComplete}
              disabled={!savedAcknowledged || !lockoutAcknowledged || completing}
              className={`app-primary-button transition-all duration-300 ${completing ? 'app-primary-button-loading' : 'w-full'}`}
            >
              {completing ? <div className="app-spinner" /> : 'Done'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Set up two-factor authentication</h3>
            <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              Scan this with an authenticator app, then enter the 6-digit code to confirm.
            </p>
          </div>

          <div className="flex justify-center">
            {isSetupLoading ? (
              <div className="app-spinner" />
            ) : setupData ? (
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={setupData.provisioning_uri} size={160} />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setup.refetch()}
                className="app-secondary-button"
                style={{ color: 'var(--app-negative)' }}
              >
                Couldn't start setup. Try again
              </button>
            )}
          </div>

          {!isSetupLoading && setupData && (
            <div className="space-y-1 text-center">
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                Or enter this key manually
              </p>
              <button
                type="button"
                onClick={copyKey}
                aria-label={keyCopied ? 'Key copied' : 'Copy key'}
                className="mx-auto flex items-center gap-2 rounded-md px-2 py-1 font-mono text-xs transition-colors duration-200 hover:bg-[color:var(--app-surface-soft)]"
                style={{ color: 'var(--app-text-muted)' }}
              >
                <span>{setupData.secret}</span>
                {keyCopied ? (
                  <Check size={14} strokeWidth={2.5} style={{ color: 'var(--app-positive)' }} aria-hidden />
                ) : (
                  <Copy size={14} strokeWidth={2} aria-hidden />
                )}
              </button>
            </div>
          )}

          <OtpInput value={code} onChange={setCode} disabled={confirming} autoFocus />

          {error && (
            <p className="text-center text-sm" style={{ color: 'var(--app-negative)' }}>
              {error}
            </p>
          )}

          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirming || code.length < OTP_LENGTH}
              className={`app-primary-button transition-all duration-300 ${confirming ? 'app-primary-button-loading' : 'w-full'}`}
            >
              {confirming ? <div className="app-spinner" /> : 'Confirm'}
            </button>
          </div>

          {onSwitchToPasskey && (
            <button
              type="button"
              onClick={onSwitchToPasskey}
              className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-colors duration-200"
              style={{ color: 'var(--app-accent)' }}
            >
              Use a passkey instead
            </button>
          )}

          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-colors duration-200"
              style={{ color: 'var(--app-accent)' }}
            >
              Skip for now
            </button>
          )}
        </div>
      )}
    </StepTransition>
  );
}
