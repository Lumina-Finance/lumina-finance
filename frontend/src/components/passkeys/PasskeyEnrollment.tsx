import { useId, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { AcknowledgementGroup } from '@/components/forms/AcknowledgementGroup'
import {
  getAcknowledgementItemId,
  getAcknowledgementProblem,
  getFirstUntickedKey,
} from '@/components/forms/acknowledgement'
import { FieldLabelRow } from '@/components/forms/FieldLabelRow'
import { FormError } from '@/components/forms/FormError'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { ModalContentFooter } from '@/components/modal/ContentPanel'
import { useConfirmPasskeyRegistration, useRegisterPasskey } from '@/api/passkeys'
import type { StepUpPayload } from '@/api/two-factor'
import { RecoveryCodesPanel } from '@/components/two-factor/RecoveryCodesPanel'
import { SetupRestart } from '@/components/two-factor/SetupRestart'
import { StepTransition } from '@/components/two-factor/StepTransition'
import { getPasskeyRegistrationMessage, isPasskeyCeremonyCancelled } from '@/utils/passkeyErrors'
import { SERVER_UNREACHABLE_MESSAGE } from '@/api/server'
import { isSetupRefused } from '@/utils/setupFailure'

const NAME_FIELDS = ['name'] as const
const ACK_FIELDS = ['acknowledgements'] as const
const ACK_KEYS = ['saved', 'lockout'] as const

interface PasskeyEnrollmentProps {
  /** Called once the passkey is active and, for a first passkey, its recovery codes are acknowledged */
  onComplete: () => void
  /** Optional skip affordance, shown during signup but not in settings */
  onSkip?: () => void
  /** Optional switch to authenticator-app enrolment, shown when both methods are on offer */
  onSwitchToTotp?: () => void
  /**
   * Password-only reauthorization for minting the registration challenge, used at signup where the
   * just-set password gates the account's first factor
   */
  setupStepUp: StepUpPayload
}

/**
 * Drives passkey enrolment at signup: the naming and browser ceremony, then the one-time recovery codes
 */
export function PasskeyEnrollment({ onComplete, onSkip, onSwitchToTotp, setupStepUp }: PasskeyEnrollmentProps) {
  const register = useRegisterPasskey()
  const confirmRegistration = useConfirmPasskeyRegistration()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [savedAcknowledged, setSavedAcknowledged] = useState(false)
  const [lockoutAcknowledged, setLockoutAcknowledged] = useState(false)
  const [activateFailed, setActivateFailed] = useState(false)
  const nameId = useId()
  const nameErrorId = `${nameId}-error`
  const ackGroupId = useId()
  const nameRefusal = useRefusedSubmit({ name: name.trim() ? undefined : 'Name is required' }, NAME_FIELDS, {
    name: nameId,
  })
  const ackTicks = [savedAcknowledged, lockoutAcknowledged]
  const ackRefusal = useRefusedSubmit({ acknowledgements: getAcknowledgementProblem(ackTicks) }, ACK_FIELDS, {
    acknowledgements: getAcknowledgementItemId(ackGroupId, getFirstUntickedKey(ACK_KEYS, ackTicks)),
  })

  /**
   * Runs the registration ceremony, staging the recovery codes to acknowledge when a batch is issued
   *
   * A cancelled browser prompt is a deliberate choice, so it stays silent and leaves the user free to
   * retry, switch method, or skip
   */
  const handleRegister = async () => {
    if (register.isPending || !nameRefusal.guard()) return
    const trimmed = name.trim()

    setError('')
    try {
      const result = await register.mutateAsync({ name: trimmed, step_up: setupStepUp })
      if (result.recovery_codes) {
        setRecoveryCodes(result.recovery_codes)
      } else {
        onComplete()
      }
    } catch (registrationError) {
      if (isPasskeyCeremonyCancelled(registrationError)) return
      setError(getPasskeyRegistrationMessage(registrationError))
    }
  }

  /**
   * Activates the staged passkey once the recovery codes are acknowledged, then hands back to the caller
   */
  const handleActivate = async () => {
    if (confirmRegistration.isPending || !ackRefusal.guard()) return

    setError('')
    try {
      await confirmRegistration.mutateAsync()
      onComplete()
    } catch (failure) {
      if (isSetupRefused(failure)) setActivateFailed(true)
      else setError(SERVER_UNREACHABLE_MESSAGE)
    }
  }

  /**
   * Returns to naming the passkey, so registering again stages a fresh one with its own recovery codes
   */
  const startAgain = () => {
    setRecoveryCodes(null)
    setSavedAcknowledged(false)
    setLockoutAcknowledged(false)
    setActivateFailed(false)
    nameRefusal.reset()
    ackRefusal.reset()
  }

  return (
    <StepTransition stepKey={recoveryCodes ? 'recovery-codes' : 'passkey-register'}>
      {recoveryCodes ? (
        <div className="space-y-5">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Save your recovery codes</h3>
            <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              Each code works once if you lose your passkey. Store them somewhere safe, you won't see them again.
            </p>
          </div>

          <RecoveryCodesPanel codes={recoveryCodes} factors={{ authenticator: false, passkeys: 1 }} />

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
                label: 'I understand I may be permanently locked out if I lose both my passkey and these codes',
                checked: lockoutAcknowledged,
                onChange: setLockoutAcknowledged,
                multiline: true,
              },
            ]}
          />

          <ModalContentFooter>
            {activateFailed ? (
              <SetupRestart onStartAgain={startAgain} />
            ) : (
              <div className="space-y-3">
                <FormError message={error} className="text-center" />
                <div className="flex justify-center">
                  <DisabledReasonButton
                    onClick={handleActivate}
                    disabled={confirmRegistration.isPending}
                    disabledReason={confirmRegistration.isPending ? undefined : ackRefusal.blockedReason}
                    className={`app-primary-button ${confirmRegistration.isPending ? 'app-primary-button-loading' : 'w-full'}`}
                  >
                    <PendingLabel pending={confirmRegistration.isPending} name="Done">
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
            <h3 className="text-base font-semibold">Protect your account with a passkey</h3>
            <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              Verify with your fingerprint, face, or device PIN when you sign in. Name it so you can tell your passkeys
              apart later.
            </p>
          </div>

          <div>
            <FieldLabelRow
              label="Passkey name"
              htmlFor={nameId}
              error={nameRefusal.errors.name}
              errorId={nameErrorId}
            />
            <input
              id={nameId}
              className={`app-input w-full ${nameRefusal.errors.name ? 'app-input-error' : ''}`}
              placeholder="Name this passkey"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={register.isPending}
              aria-label="New passkey name"
              aria-invalid={nameRefusal.errors.name ? true : undefined}
              aria-describedby={nameRefusal.errors.name ? nameErrorId : undefined}
            />
          </div>

          <FormError message={error} className="text-center" />

          <div className="flex justify-center">
            <DisabledReasonButton
              onClick={handleRegister}
              disabled={register.isPending}
              disabledReason={register.isPending ? undefined : nameRefusal.blockedReason}
              className={`app-primary-button ${register.isPending ? 'app-primary-button-loading' : 'flex w-full items-center justify-center gap-2'}`}
            >
              <PendingLabel pending={register.isPending} name="Set up a passkey" className="gap-2">
                <KeyRound size={16} aria-hidden />
                Set up a passkey
              </PendingLabel>
            </DisabledReasonButton>
          </div>

          {onSwitchToTotp && (
            <button
              type="button"
              onClick={onSwitchToTotp}
              className="block w-full text-center text-sm font-medium underline underline-offset-2 transition-control"
              style={{ color: 'var(--app-accent)' }}
            >
              Use an authenticator app instead
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
