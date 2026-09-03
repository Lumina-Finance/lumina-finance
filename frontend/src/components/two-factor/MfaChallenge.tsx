import type { FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { OtpInput, OTP_LENGTH } from '@/components/OtpInput';
import { WarningCallout } from '@/components/WarningCallout';

/**
 * What this screen may offer for a second-factor challenge
 *
 * Deliberately not the backend's challenge shape. `canOfferPasskey` is the caller's decision rather
 * than the server's `passkey_available`, because the password reset screen also requires the browser
 * to support the ceremony before it offers the option, and sign-in does not
 */
export interface MfaChallengeInfo {
  canEnterAuthenticatorCode: boolean;
  canOfferPasskey: boolean;
  isRecoveryOnly: boolean;
}

interface MfaChallengeProps {
  challenge: MfaChallengeInfo;
  usePasskey: boolean;
  useRecoveryCode: boolean;
  code: string;
  onCodeChange: (value: string) => void;
  submitting: boolean;
  passkeySubmitting: boolean;

  // Called only when hasAncestorForm is false — otherwise the page's own surrounding form already
  // owns submission and this prop is left unset
  onSubmitCode?: (event: FormEvent<HTMLFormElement>) => void;
  onVerifyPasskey: () => void;
  onSwitchToAuthenticator: () => void;
  onSwitchToRecovery: () => void;
  onSwitchToPasskey: () => void;
  onToggleRecoveryCode: () => void;
  onCancel: () => void;

  /** Sentence under the passkey prompt naming what verifying finishes */
  passkeyVerifyDescription: string;

  // Login wraps its whole page in one form that already switches its submit handler for this step,
  // so only a page without such a form, like the reset flow, needs this component to render its own
  hasAncestorForm: boolean;
}

/**
 * Renders the second-factor challenge shared by login and password reset: the passkey prompt with its
 * fallback links, the authenticator-code and recovery-code entry with its own fallback links, and the
 * link back out of the challenge
 */
export function MfaChallenge({
  challenge,
  usePasskey,
  useRecoveryCode,
  code,
  onCodeChange,
  submitting,
  passkeySubmitting,
  onSubmitCode,
  onVerifyPasskey,
  onSwitchToAuthenticator,
  onSwitchToRecovery,
  onSwitchToPasskey,
  onToggleRecoveryCode,
  onCancel,
  passkeyVerifyDescription,
  hasAncestorForm,
}: MfaChallengeProps) {
  const trimmedCode = useRecoveryCode ? code.trim() : code;
  const codeReady = useRecoveryCode ? trimmedCode.length > 0 : trimmedCode.length >= OTP_LENGTH;

  const codeBranch = (
    <>
      <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
        {challenge.isRecoveryOnly
          ? 'Your second factors were removed. Enter a recovery code to continue.'
          : useRecoveryCode
            ? 'Enter one of your recovery codes.'
            : 'Enter the 6-digit code from your authenticator app.'}
      </p>

      {useRecoveryCode && (
        <WarningCallout>
          {challenge.isRecoveryOnly
            ? "Each recovery-code sign-in spends one of your remaining codes and signs you out everywhere. If you run out before you set up a new factor, you'll be permanently locked out of your account."
            : "Using a recovery code removes all your authenticators and passkeys and signs you out everywhere. You'll set up a new factor before you can use your account again."}
        </WarningCallout>
      )}

      {useRecoveryCode ? (
        <input
          className="app-input w-full"
          placeholder="Recovery code"
          // A recovery code is not a TOTP code, so suppress one-time-code autofill from password managers
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          value={code}
          onChange={(event) => onCodeChange(event.target.value)}
          disabled={submitting}
          autoFocus
        />
      ) : (
        <OtpInput value={code} onChange={onCodeChange} disabled={submitting} autoFocus />
      )}

      <div className="flex justify-center">
        <button
          type="submit"
          disabled={submitting || !codeReady}
          className={`app-primary-button transition-all duration-300 ${
            submitting ? 'app-primary-button-loading' : 'w-full'
          }`}
        >
          {submitting ? <div className="app-spinner" /> : 'Verify'}
        </button>
      </div>

      {challenge.canEnterAuthenticatorCode && (
        <button
          type="button"
          onClick={onToggleRecoveryCode}
          className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-colors duration-200"
          style={{ color: 'var(--app-accent)' }}
        >
          {useRecoveryCode ? 'Use authenticator code' : 'Enter a recovery code instead'}
        </button>
      )}

      {challenge.canOfferPasskey && (
        <button
          type="button"
          onClick={onSwitchToPasskey}
          className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-colors duration-200"
          style={{ color: 'var(--app-accent)' }}
        >
          Use a passkey instead
        </button>
      )}
    </>
  );

  return (
    <>
      {usePasskey ? (
        <>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {passkeyVerifyDescription}
          </p>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={onVerifyPasskey}
              disabled={passkeySubmitting}
              className={`app-primary-button transition-all duration-300 ${passkeySubmitting ? 'app-primary-button-loading' : 'flex w-full items-center justify-center gap-2'}`}
            >
              {passkeySubmitting ? (
                <div className="app-spinner" />
              ) : (
                <>
                  <KeyRound size={16} aria-hidden />
                  Verify with a passkey
                </>
              )}
            </button>
          </div>

          {challenge.canEnterAuthenticatorCode && (
            <button
              type="button"
              onClick={onSwitchToAuthenticator}
              className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-colors duration-200"
              style={{ color: 'var(--app-accent)' }}
            >
              Use authenticator code instead
            </button>
          )}

          <button
            type="button"
            onClick={onSwitchToRecovery}
            className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-colors duration-200"
            style={{ color: 'var(--app-accent)' }}
          >
            Enter a recovery code instead
          </button>
        </>
      ) : hasAncestorForm ? (
        codeBranch
      ) : (
        <form onSubmit={onSubmitCode} className="space-y-6" noValidate>
          {codeBranch}
        </form>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-colors duration-200"
        style={{ color: 'var(--app-text-muted)' }}
      >
        Back to login
      </button>
    </>
  );
}
