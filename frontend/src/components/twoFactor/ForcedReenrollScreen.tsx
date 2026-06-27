import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useReenrollTotp, useSetupTotp } from '@/api/twoFactor';
import { OtpInput } from '@/components/OtpInput';
import { WarningCallout } from '@/components/twoFactor/WarningCallout';
import { useAuth } from '@/hooks/useAuth';
import { copyText } from '@/utils/clipboard';
import { delayToMinimum } from '@/utils/timing';

const OTP_LENGTH = 6;
const COPIED_FEEDBACK_MS = 1500;

// Hold the QR behind the spinner this long so a fast secret does not flash in
const SETUP_LOADING_MIN_MS = 800;

/**
 * Blocks the app after a recovery-code login until the user sets up a fresh authenticator
 *
 * The session can reach nothing else until re-enrolment clears the restriction, so this screen owns
 * the whole viewport and offers only the setup flow and a sign out
 */
export default function ForcedReenrollScreen() {
  const { user, setUser, logout } = useAuth();
  const setup = useSetupTotp();
  const reenroll = useReenrollTotp();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [minLoadingElapsed, setMinLoadingElapsed] = useState(false);
  const copyResetTimer = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinLoadingElapsed(true), SETUP_LOADING_MIN_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current);
    };
  }, []);

  const isSetupLoading = !minLoadingElapsed || (!setup.data && !setup.isError);

  /**
   * Copies the secret and briefly confirms it so the user need not select the text
   */
  const copyKey = async () => {
    if (!setup.data || !(await copyText(setup.data.secret))) return;

    setKeyCopied(true);
    if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current);
    copyResetTimer.current = window.setTimeout(() => setKeyCopied(false), COPIED_FEEDBACK_MS);
  };

  /**
   * Verifies the new authenticator code, clearing the restriction on success so the app unlocks
   */
  const handleVerify = async () => {
    if (code.length < OTP_LENGTH || verifying) return;

    setError('');
    setVerifying(true);
    const start = Date.now();
    try {
      await reenroll.mutateAsync({ code });
      await delayToMinimum(start);
      if (user) setUser({ ...user, totp_reenrollment_required: false });
    } catch {
      await delayToMinimum(start);
      setError('That code was incorrect. Try again.');
      setCode('');
      setVerifying(false);
    }
  };

  return (
    <div
      className="flex min-h-[100dvh] items-start justify-center px-4 pt-[10dvh] lg:pt-[20dvh]"
      style={{ backgroundColor: 'var(--app-bg)' }}
    >
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-4xl font-normal tracking-tight">Two-factor</h1>

        <div className="mt-5 space-y-5">
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            You signed in with a recovery code, so your previous authenticator was removed. Set up a new
            one to get back into your account.
          </p>

          <WarningCallout>
            You can't use your account until you finish. Each recovery-code sign-in spends one of your
            remaining codes, and running out before you re-enrol locks you out permanently.
          </WarningCallout>

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

        <OtpInput value={code} onChange={setCode} disabled={verifying} autoFocus />

        {error && (
          <p className="text-center text-sm" style={{ color: 'var(--app-negative)' }}>
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleVerify}
          disabled={verifying || code.length < OTP_LENGTH}
          className="app-primary-button w-full"
        >
          {verifying ? <div className="app-spinner" /> : 'Verify and unlock'}
        </button>

          <button
            type="button"
            onClick={() => void logout()}
            className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-colors duration-200"
            style={{ color: 'var(--app-accent)' }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
