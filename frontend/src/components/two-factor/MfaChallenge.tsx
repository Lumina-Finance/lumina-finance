import { useRef, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { KeyRound } from 'lucide-react'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { OtpInput, OTP_LENGTH } from '@/components/OtpInput'
import { WarningCallout } from '@/components/WarningCallout'
import { onUserPress } from '@/utils/userPress'

// Centred links take the width of their text, so a keyboard focus ring hugs the words instead of
// spanning the whole row
const LINK_BUTTON_CLASS_NAME =
  'mx-auto block text-center text-sm font-medium underline underline-offset-2 transition-control'

/**
 * What this screen may offer for a second-factor challenge
 *
 * Deliberately not the backend's challenge shape. `canOfferPasskey` is the caller's decision rather
 * than the server's `passkey_available`, because the password reset screen also requires the browser
 * to support the ceremony before it offers the option, and sign-in does not
 */
export interface MfaChallengeInfo {
  canEnterAuthenticatorCode: boolean
  canOfferPasskey: boolean
  isRecoveryOnly: boolean
}

interface MfaChallengeProps {
  challenge: MfaChallengeInfo
  usePasskey: boolean
  useRecoveryCode: boolean
  code: string
  onCodeChange: (value: string) => void
  submitting: boolean
  passkeySubmitting: boolean

  // Called only when hasAncestorForm is false — otherwise the page's own surrounding form already
  // owns submission and this prop is left unset
  onSubmitCode?: (event: FormEvent<HTMLFormElement>) => void
  onVerifyPasskey: () => void
  onSwitchToAuthenticator: () => void
  onSwitchToRecovery: () => void
  onSwitchToPasskey: () => void
  onToggleRecoveryCode: () => void
  onCancel: () => void

  /** Sentence under the passkey prompt naming what verifying finishes */
  passkeyVerifyDescription: string

  // Login wraps its whole page in one form that already switches its submit handler for this step,
  // so only a page without such a form, like the reset flow, needs this component to render its own
  hasAncestorForm: boolean
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
  const verifyButtonRef = useRef<HTMLButtonElement>(null)
  const trimmedCode = useRecoveryCode ? code.trim() : code
  const codeReady = useRecoveryCode ? trimmedCode.length > 0 : trimmedCode.length >= OTP_LENGTH

  /**
   * Submits an authenticator code as soon as it's complete, whether it was typed, pasted or filled
   * by a password manager, so signing in needs no click a password manager could aim at the wrong
   * button. It submits through the form that owns Verify, the login page's own or this component's,
   * so each page's submit handler runs as it does for a click
   */
  const changeAuthenticatorCode = (value: string) => {
    // The submit handler reads the code from state, so the new code renders before the submit
    flushSync(() => onCodeChange(value))
    if (value.length === OTP_LENGTH) verifyButtonRef.current?.form?.requestSubmit()
  }

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
        <OtpInput value={code} onChange={changeAuthenticatorCode} disabled={submitting} autoFocus />
      )}

      <div className="flex justify-center">
        <DisabledReasonButton
          ref={verifyButtonRef}
          type="submit"
          disabled={submitting}
          disabledReason={
            !submitting && !codeReady
              ? useRecoveryCode
                ? 'Enter a recovery code first'
                : 'Enter the full code first'
              : undefined
          }
          className={`app-primary-button ${submitting ? 'app-primary-button-loading' : 'w-full'}`}
        >
          <PendingLabel pending={submitting} name="Verify">
            Verify
          </PendingLabel>
        </DisabledReasonButton>
      </div>

      {challenge.canEnterAuthenticatorCode && (
        <button
          type="button"
          onClick={onToggleRecoveryCode}
          className={LINK_BUTTON_CLASS_NAME}
          style={{ color: 'var(--app-accent)' }}
        >
          {useRecoveryCode ? 'Use authenticator code' : 'Enter a recovery code instead'}
        </button>
      )}

      {challenge.canOfferPasskey && (
        <button
          type="button"
          onClick={onSwitchToPasskey}
          className={LINK_BUTTON_CLASS_NAME}
          style={{ color: 'var(--app-accent)' }}
        >
          Use a passkey instead
        </button>
      )}
    </>
  )

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
              className={`app-primary-button ${passkeySubmitting ? 'app-primary-button-loading' : 'flex w-full items-center justify-center gap-2'}`}
            >
              <PendingLabel pending={passkeySubmitting} name="Verify with a passkey" className="gap-2">
                <KeyRound size={16} aria-hidden />
                Verify with a passkey
              </PendingLabel>
            </button>
          </div>

          {challenge.canEnterAuthenticatorCode && (
            <button
              type="button"
              onClick={onSwitchToAuthenticator}
              className={LINK_BUTTON_CLASS_NAME}
              style={{ color: 'var(--app-accent)' }}
            >
              Use authenticator code instead
            </button>
          )}

          <button
            type="button"
            onClick={onSwitchToRecovery}
            className={LINK_BUTTON_CLASS_NAME}
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
        // A password manager that fills the code then clicks what it takes for the sign-in button can
        // pick this one, since translations of it name logging in
        onClick={onUserPress(onCancel)}
        className={LINK_BUTTON_CLASS_NAME}
        style={{ color: 'var(--app-text-muted)' }}
      >
        Back to login
      </button>
    </>
  )
}
