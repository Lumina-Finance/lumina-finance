import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useCompleteTotp, useConfirmTotp, useSetupTotp } from '@/api/twoFactor';
import { OtpInput, OTP_LENGTH } from '@/components/OtpInput';
import { RecoveryCodesPanel } from '@/components/twoFactor/RecoveryCodesPanel';
import { copyText } from '@/utils/clipboard';
import { delayToMinimum } from '@/utils/timing';

// How long the copied confirmation stays before reverting to the copy affordance
const COPIED_FEEDBACK_MS = 1500;

// Hold the QR and key behind the spinner this long so a fast secret does not flash in
const SETUP_LOADING_MIN_MS = 800;

// Cross-fade with a small slide, matching the auth page so the confirm step gives way smoothly
const VIEW_TRANSITION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const },
};

interface TotpEnrollmentProps {
  /** Called once 2FA is confirmed and the recovery codes are acknowledged */
  onComplete: () => void;
  /** Optional skip affordance, shown during signup but not in settings */
  onSkip?: () => void;
}

/**
 * Drives the shared TOTP enrolment flow: the QR and code confirmation, then the one-time recovery codes
 */
export function TotpEnrollment({ onComplete, onSkip }: TotpEnrollmentProps) {
  const setup = useSetupTotp();
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
  const isSetupLoading = !minLoadingElapsed || (!setup.data && !setup.isError);

  /**
   * Copies the secret to the clipboard and briefly confirms it so the user need not select the text
   */
  const copyKey = async () => {
    if (!setup.data || !(await copyText(setup.data.secret))) return;

    setKeyCopied(true);
    if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current);
    copyResetTimer.current = window.setTimeout(() => setKeyCopied(false), COPIED_FEEDBACK_MS);
  };

  /**
   * Confirms the entered code, revealing the recovery codes on success and allowing a retry on failure
   */
  const handleConfirm = async () => {
    if (code.length < OTP_LENGTH || confirming) return;

    setError('');
    setConfirming(true);
    const start = Date.now();
    try {
      const result = await confirm.mutateAsync({ code });
      await delayToMinimum(start);

      // An empty batch means the account already had recovery codes, so two-factor turned on now and
      // there is nothing to acknowledge
      if (result.recovery_codes.length > 0) {
        setRecoveryCodes(result.recovery_codes);
      } else {
        setEnabledViaReuse(true);
      }
    } catch {
      await delayToMinimum(start);
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
      await delayToMinimum(start);
      onComplete();
    } catch {
      await delayToMinimum(start);
      setError('Could not finish setup. Try again.');
      setCompleting(false);
    }
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {enabledViaReuse ? (
        <motion.div key="reuse-done" className="space-y-5" {...VIEW_TRANSITION}>
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Two-factor is on</h3>
            <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              Your existing recovery codes also cover your authenticator, so there are no new codes to save.
            </p>
          </div>

          <button type="button" onClick={onComplete} className="app-primary-button w-full">
            Done
          </button>
        </motion.div>
      ) : recoveryCodes ? (
        <motion.div key="recovery-codes" className="space-y-5" {...VIEW_TRANSITION}>
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

          <button
            type="button"
            onClick={handleComplete}
            disabled={!savedAcknowledged || !lockoutAcknowledged || completing}
            className="app-primary-button w-full"
          >
            {completing ? <div className="app-spinner" /> : 'Done'}
          </button>
        </motion.div>
      ) : (
        <motion.div key="totp-confirm" className="space-y-5" {...VIEW_TRANSITION}>
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Set up two-factor authentication</h3>
            <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              Scan this with an authenticator app, then enter the 6-digit code to confirm.
            </p>
          </div>

          <div className="flex justify-center">
            {isSetupLoading ? (
              <div className="app-spinner" />
            ) : setup.data ? (
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={setup.data.provisioning_uri} size={160} />
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

          {!isSetupLoading && setup.data && (
            <div className="space-y-1 text-center">
              <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
                Or enter this key manually
              </p>
              <button
                type="button"
                onClick={copyKey}
                aria-label={keyCopied ? 'Key copied' : 'Copy key'}
                className="mx-auto flex items-center gap-2 rounded-md px-2 py-1 font-mono text-xs transition-colors duration-200 hover:bg-[color:var(--app-surface-soft)]"
                style={{ color: 'var(--app-text-muted)' }}
              >
                <span>{setup.data.secret}</span>
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

          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirming || code.length < OTP_LENGTH}
            className="app-primary-button w-full"
          >
            {confirming ? <div className="app-spinner" /> : 'Confirm'}
          </button>

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
        </motion.div>
      )}
    </AnimatePresence>
  );
}
