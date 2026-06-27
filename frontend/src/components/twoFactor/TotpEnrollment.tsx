import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { useConfirmTotp, useSetupTotp } from '@/api/twoFactor';
import { OtpInput } from '@/components/OtpInput';
import { delayToMinimum } from '@/utils/timing';

const OTP_LENGTH = 6;
const RECOVERY_CODES_FILENAME = 'lumina-recovery-codes.txt';

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
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [savedAcknowledged, setSavedAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Generate the pending secret once when the flow opens
  const startSetup = setup.mutate;
  useEffect(() => {
    startSetup();
  }, [startSetup]);

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
      setRecoveryCodes(result.recovery_codes);
    } catch {
      await delayToMinimum(start);
      setError('That code was incorrect. Try again.');
      setCode('');
    } finally {
      setConfirming(false);
    }
  };

  /**
   * Copies the recovery codes to the clipboard as newline-separated text
   */
  const copyCodes = () => {
    if (recoveryCodes) void navigator.clipboard.writeText(recoveryCodes.join('\n'));
  };

  /**
   * Downloads the recovery codes as a text file
   */
  const downloadCodes = () => {
    if (!recoveryCodes) return;

    const url = URL.createObjectURL(new Blob([recoveryCodes.join('\n')], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = RECOVERY_CODES_FILENAME;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {recoveryCodes ? (
        <motion.div key="recovery-codes" className="space-y-5" {...VIEW_TRANSITION}>
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Save your recovery codes</h3>
            <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              Each code works once if you lose your authenticator. Store them somewhere safe, you won't see them again.
            </p>
          </div>

          <ul
            className="space-y-1 rounded-lg p-4 font-mono text-sm"
            style={{ backgroundColor: 'var(--app-surface-soft)' }}
          >
            {recoveryCodes.map((recoveryCode) => (
              <li key={recoveryCode}>{recoveryCode}</li>
            ))}
          </ul>

          <div className="flex gap-2">
            <button type="button" onClick={copyCodes} className="app-secondary-button flex-1">
              Copy
            </button>
            <button type="button" onClick={downloadCodes} className="app-secondary-button flex-1">
              Download
            </button>
          </div>

          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--app-text-muted)' }}>
            <input
              type="checkbox"
              checked={savedAcknowledged}
              onChange={(event) => setSavedAcknowledged(event.target.checked)}
            />
            I've saved my recovery codes
          </label>

          <button
            type="button"
            onClick={onComplete}
            disabled={!savedAcknowledged}
            className="app-primary-button w-full"
          >
            Done
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
            {setup.data ? (
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={setup.data.provisioning_uri} size={160} />
              </div>
            ) : (
              <div className="app-spinner" />
            )}
          </div>

          {setup.data && (
            <p className="text-center text-xs" style={{ color: 'var(--app-text-muted)' }}>
              Or enter this key manually: <span className="font-mono">{setup.data.secret}</span>
            </p>
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
