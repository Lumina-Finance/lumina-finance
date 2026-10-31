import { useEffect, useId, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { QRCodeSVG } from 'qrcode.react'
import { AcknowledgementGroup } from '@/components/forms/AcknowledgementGroup'
import {
  getAcknowledgementItemId,
  getAcknowledgementProblem,
  getFirstUntickedKey,
} from '@/components/forms/acknowledgement'
import { FieldLabelRow } from '@/components/forms/FieldLabelRow'
import { FormError } from '@/components/forms/FormError'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { ModalContentFooter } from '@/components/modal/ContentPanel'
import {
  useCompleteTotp,
  useConfirmTotp,
  useSetupTotp,
  type RecoveryCodesResponse,
  type StepUpPayload,
  type TotpSetupResponse,
} from '@/api/two-factor'
import { OtpInput, OTP_LENGTH } from '@/components/OtpInput'

// Every step of the enrolment flow titles itself with this, and only one step is mounted at a time,
// so the modal's label follows whichever step is on screen
export const TOTP_ENROLLMENT_TITLE_ID = 'totp-enrollment-title'
import { RecoveryCodesPanel } from '@/components/two-factor/RecoveryCodesPanel'
import { SetupRestart } from '@/components/two-factor/SetupRestart'
import { StepTransition } from '@/components/two-factor/StepTransition'
import { copyText } from '@/utils/clipboard'
import { SERVER_UNREACHABLE_MESSAGE } from '@/api/server'
import { isSetupRefused } from '@/utils/setupFailure'
import { delayToMinimum, LOADING_ANIMATION_MIN_MS, MFA_LOADING_MIN_MS } from '@/utils/timing'

// How long the copied confirmation stays before reverting to the copy affordance
const COPIED_FEEDBACK_MS = 1500

const WRONG_CODE_MESSAGE = 'That code was incorrect. Try again.'
const CODE_FIELDS = ['code'] as const
const ACK_FIELDS = ['acknowledgements'] as const
const ACK_KEYS = ['saved', 'lockout'] as const

interface TotpEnrollmentProps {
  /** Called once 2FA is confirmed and the recovery codes are acknowledged */
  onComplete: () => void
  /** Optional skip affordance, shown during signup but not in settings */
  onSkip?: () => void
  /** Optional switch back to passkey enrolment, shown at signup when the origin supports passkeys */
  onSwitchToPasskey?: () => void
  /**
   * A secret already minted after stepping up, used in settings where the step-up prompt ran and
   * fetched it before opening enrolment. When set, enrolment does not mint its own
   */
  initialSetup?: TotpSetupResponse
  /**
   * Password-only reauthorization for minting the secret, used at signup where the just-set password
   * gates the account's first factor. Omitted for a forced re-enrolment
   */
  setupStepUp?: StepUpPayload
  /**
   * Starts enrolment over from the step-up that minted `initialSetup`, which only the caller can rerun.
   * Without it, enrolment mints a fresh secret itself
   */
  onRestart?: () => void
  /** Classes for each step's heading, which a modal sets in its own title style */
  titleClassName?: string
}

const DEFAULT_TITLE_CLASS_NAME = 'text-base font-semibold'

/**
 * Drives the shared TOTP enrolment flow: the QR and code confirmation, then the one-time recovery codes
 */
export function TotpEnrollment({
  onComplete,
  onSkip,
  onSwitchToPasskey,
  initialSetup,
  setupStepUp,
  onRestart,
  titleClassName = DEFAULT_TITLE_CLASS_NAME,
}: TotpEnrollmentProps) {
  // Settings supplies a secret it already stepped up for, so this only mints one for signup and re-enrol
  const setup = useSetupTotp({ enabled: !initialSetup, stepUp: setupStepUp })
  // A failed refetch keeps the previous secret cached, which a restart has already abandoned, so an error
  // shows the retry button rather than a QR that can no longer be confirmed
  const setupData = initialSetup ?? (setup.isError ? undefined : setup.data)
  const confirm = useConfirmTotp()
  const complete = useCompleteTotp()
  const [minLoadingElapsed, setMinLoadingElapsed] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [enabledViaReuse, setEnabledViaReuse] = useState(false)
  const [savedAcknowledged, setSavedAcknowledged] = useState(false)
  const [lockoutAcknowledged, setLockoutAcknowledged] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [finishFailed, setFinishFailed] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)
  const copyResetTimer = useRef<number | null>(null)
  // The server refused the code that was entered, which is a problem with the code field
  const [codeError, setCodeError] = useState('')
  const codeId = useId()
  const codeErrorId = `${codeId}-error`
  const ackGroupId = useId()
  const codeRefusal = useRefusedSubmit(
    { code: codeError || (code.length < OTP_LENGTH ? 'Enter the full code' : undefined) },
    CODE_FIELDS,
    { code: codeId },
  )
  const ackTicks = [savedAcknowledged, lockoutAcknowledged]
  const ackRefusal = useRefusedSubmit({ acknowledgements: getAcknowledgementProblem(ackTicks) }, ACK_FIELDS, {
    acknowledgements: getAcknowledgementItemId(ackGroupId, getFirstUntickedKey(ACK_KEYS, ackTicks)),
  })

  // Hold the spinner for a fixed minimum from mount so a fast secret does not flash the QR in
  useEffect(() => {
    const timer = window.setTimeout(() => setMinLoadingElapsed(true), LOADING_ANIMATION_MIN_MS)
    return () => window.clearTimeout(timer)
  }, [])

  // A pending copy timer would fire setState after the modal closes, so it is cleared on unmount
  useEffect(() => {
    return () => {
      if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current)
    }
  }, [])

  // The spinner stays until both the minimum has elapsed and the secret has resolved
  // A restart refetches while the old secret is still cached, so the spinner covers that refetch too
  const isSetupLoading = !minLoadingElapsed || (!setupData && !setup.isError) || setup.isFetching

  /**
   * Copies the secret to the clipboard and briefly confirms it so the user need not select the text
   */
  const copyKey = async () => {
    if (!setupData || !(await copyText(setupData.secret))) return

    setKeyCopied(true)
    if (copyResetTimer.current) window.clearTimeout(copyResetTimer.current)
    copyResetTimer.current = window.setTimeout(() => setKeyCopied(false), COPIED_FEEDBACK_MS)
  }

  /**
   * Reveals the recovery codes to save, or notes two-factor turned on directly when a batch already
   * existed so there is nothing to acknowledge
   */
  const applyConfirmResult = (result: RecoveryCodesResponse) => {
    if (result.recovery_codes.length > 0) {
      setRecoveryCodes(result.recovery_codes)
    } else {
      setEnabledViaReuse(true)
    }
  }

  /**
   * Confirms the entered code, revealing the recovery codes on success and allowing a retry on failure
   * The step-up already ran when the secret was minted, so confirm carries only the code
   */
  const handleConfirm = async () => {
    if (confirming || !codeRefusal.guard()) return

    setError('')
    setConfirming(true)
    const start = Date.now()
    try {
      const result = await confirm.mutateAsync({ code })
      await delayToMinimum(start, MFA_LOADING_MIN_MS)
      applyConfirmResult(result)
    } catch {
      await delayToMinimum(start, MFA_LOADING_MIN_MS)
      // The wrong code belongs to the field, which the refusal marks until the person types again
      setCodeError(WRONG_CODE_MESSAGE)
      codeRefusal.markRefused()
      setCode('')
    } finally {
      setConfirming(false)
    }
  }

  /**
   * Turns two-factor on once the recovery codes are acknowledged, then hands back to the caller
   */
  const handleComplete = async () => {
    if (completing || !ackRefusal.guard()) return

    setError('')
    setCompleting(true)
    const start = Date.now()
    try {
      await complete.mutateAsync()
      await delayToMinimum(start, MFA_LOADING_MIN_MS)
      onComplete()
    } catch (failure) {
      await delayToMinimum(start, MFA_LOADING_MIN_MS)
      if (isSetupRefused(failure)) setFinishFailed(true)
      else setError(SERVER_UNREACHABLE_MESSAGE)
      setCompleting(false)
    }
  }

  /**
   * Returns to the QR step with a fresh secret, or hands the restart to the caller that minted the secret
   */
  const startAgain = () => {
    if (onRestart) {
      onRestart()
      return
    }

    setRecoveryCodes(null)
    setSavedAcknowledged(false)
    setLockoutAcknowledged(false)
    setFinishFailed(false)
    setCode('')
    setCodeError('')
    setError('')
    codeRefusal.reset()
    ackRefusal.reset()
    setup.refetch()
  }

  const stepKey = enabledViaReuse ? 'reuse-done' : recoveryCodes ? 'recovery-codes' : 'totp-confirm'

  return (
    <StepTransition stepKey={stepKey}>
      {enabledViaReuse ? (
        <div className="space-y-5">
          <div className="space-y-1">
            <h3 id={TOTP_ENROLLMENT_TITLE_ID} className={titleClassName}>
              Two-factor is on
            </h3>
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
            <h3 id={TOTP_ENROLLMENT_TITLE_ID} className={titleClassName}>
              Save your recovery codes
            </h3>
            <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              Each code works once if you lose your authenticator. Store them somewhere safe, you won't see them again.
            </p>
          </div>

          <RecoveryCodesPanel codes={recoveryCodes} factors={{ authenticator: true, passkeys: 0 }} />

          <AcknowledgementGroup
            groupId={ackGroupId}
            heading="Before you continue"
            error={ackRefusal.errors.acknowledgements}
            errorId={`${ackGroupId}-error`}
            items={[
              {
                key: 'saved',
                label: "I've saved my recovery codes",
                checked: savedAcknowledged,
                onChange: setSavedAcknowledged,
              },
              {
                key: 'lockout',
                label: 'I understand I may be permanently locked out if I lose both my authenticator and these codes',
                checked: lockoutAcknowledged,
                onChange: setLockoutAcknowledged,
                multiline: true,
              },
            ]}
          />

          <ModalContentFooter>
            {finishFailed ? (
              <SetupRestart onStartAgain={startAgain} />
            ) : (
              <div className="space-y-3">
                <FormError message={error} className="text-center" />
                <div className="flex justify-center">
                  <DisabledReasonButton
                    onClick={handleComplete}
                    disabled={completing}
                    disabledReason={completing ? undefined : ackRefusal.blockedReason}
                    className={`app-primary-button ${completing ? 'app-primary-button-loading' : 'w-full'}`}
                  >
                    <PendingLabel pending={completing} name="Done">
                      Done
                    </PendingLabel>
                  </DisabledReasonButton>
                </div>
              </div>
            )}
          </ModalContentFooter>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="space-y-1">
            <h3 id={TOTP_ENROLLMENT_TITLE_ID} className={titleClassName}>
              Set up two-factor authentication
            </h3>
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
                className="mx-auto flex items-center gap-2 rounded-md px-2 py-1 font-mono text-xs transition-control hover:bg-[color:var(--app-hover-soft)]"
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

          <div>
            <FieldLabelRow
              label="One-time code"
              htmlFor={codeId}
              error={codeRefusal.errors.code}
              errorId={codeErrorId}
            />
            <OtpInput
              id={codeId}
              value={code}
              onChange={(value) => {
                setCode(value)
                if (codeError) {
                  setCodeError('')
                  codeRefusal.reset()
                }
              }}
              disabled={confirming}
              autoFocus
              hasError={!!codeRefusal.errors.code}
              errorId={codeErrorId}
            />
          </div>

          <FormError message={error} className="text-center" />

          <div className="flex justify-center">
            <DisabledReasonButton
              onClick={handleConfirm}
              disabled={confirming}
              disabledReason={confirming ? undefined : codeRefusal.blockedReason}
              className={`app-primary-button ${confirming ? 'app-primary-button-loading' : 'w-full'}`}
            >
              <PendingLabel pending={confirming} name="Confirm">
                Confirm
              </PendingLabel>
            </DisabledReasonButton>
          </div>

          {onSwitchToPasskey && (
            <button
              type="button"
              onClick={onSwitchToPasskey}
              className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-control"
              style={{ color: 'var(--app-accent)' }}
            >
              Use a passkey instead
            </button>
          )}

          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-control"
              style={{ color: 'var(--app-accent)' }}
            >
              Skip for now
            </button>
          )}
        </div>
      )}
    </StepTransition>
  )
}
