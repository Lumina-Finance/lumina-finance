import { KeyRound } from 'lucide-react'
import { useId, useState } from 'react'
import { usePasskeyConfig, useConfirmPasskeyRegistration, useRegisterPasskey } from '@/api/passkeys'
import { FieldLabelRow } from '@/components/forms/FieldLabelRow'
import { FormError } from '@/components/forms/FormError'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { RecoveryCodesModal } from '@/components/two-factor/RecoveryCodesModal'
import { WarningCallout } from '@/components/WarningCallout'
import { getPasskeyRegistrationMessage } from '@/utils/passkeyErrors'
import { assessPasskeySupport } from '@/utils/passkeySupport'

const RECOVERY_CODES_DESCRIPTION =
  "Save these recovery codes. They're the only way back into your account if you lose your passkey. You won't see them again."

const NAME_FIELDS = ['name'] as const

interface PasskeyReenrollmentProps {
  /** Called once a passkey is active, which also lifts the re-enrolment restriction */
  onComplete: () => void
}

/**
 * Re-establishes two-factor with a passkey from the restricted post-recovery screen
 *
 * When the recovery batch was exhausted to sign in, the passkey is staged and a fresh batch is issued
 * to acknowledge before it activates. Otherwise the passkey is active at once and the screen completes
 */
export function PasskeyReenrollment({ onComplete }: PasskeyReenrollmentProps) {
  const config = usePasskeyConfig()
  const register = useRegisterPasskey()
  const confirmRegistration = useConfirmPasskeyRegistration()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [pendingRecoveryCodes, setPendingRecoveryCodes] = useState<string[] | null>(null)
  const nameId = useId()
  const nameErrorId = `${nameId}-error`
  const nameRefusal = useRefusedSubmit({ name: name.trim() ? undefined : 'Name is required' }, NAME_FIELDS, {
    name: nameId,
  })

  const support = config.data ? assessPasskeySupport(config.data.rp_id) : null

  /**
   * Runs the ceremony, staging the recovery codes to acknowledge when a fresh batch is issued
   */
  async function handleRegister() {
    if (register.isPending || !nameRefusal.guard()) return
    const trimmed = name.trim()

    setError('')
    try {
      // A forced re-enrol has no factor to present, so it registers without a step-up, which the backend
      // allows only for a re-enrolment session
      const result = await register.mutateAsync({ name: trimmed })
      if (result.recovery_codes) {
        setPendingRecoveryCodes(result.recovery_codes)
      } else {
        onComplete()
      }
    } catch (registrationError) {
      setError(getPasskeyRegistrationMessage(registrationError))
    }
  }

  /**
   * Activates the staged passkey once its recovery codes are acknowledged, then completes
   */
  async function acknowledgeRecoveryCodes() {
    await confirmRegistration.mutateAsync()
    setPendingRecoveryCodes(null)
    onComplete()
  }

  if (support && !support.supported) {
    return <WarningCallout>{support.message}</WarningCallout>
  }

  return (
    <div className="space-y-4">
      <div>
        <FieldLabelRow label="Passkey name" htmlFor={nameId} error={nameRefusal.errors.name} errorId={nameErrorId} />
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

      <div className="flex justify-center">
        <DisabledReasonButton
          onClick={handleRegister}
          disabled={register.isPending}
          disabledReason={register.isPending ? undefined : nameRefusal.blockedReason}
          className={`app-primary-button ${register.isPending ? 'app-primary-button-loading' : 'flex w-full items-center justify-center gap-2'}`}
        >
          {register.isPending ? (
            <div className="app-spinner" />
          ) : (
            <>
              <KeyRound size={16} aria-hidden />
              Set up a passkey
            </>
          )}
        </DisabledReasonButton>
      </div>

      <FormError message={error} />

      <RecoveryCodesModal
        open={pendingRecoveryCodes !== null}
        codes={pendingRecoveryCodes}
        factors={{ authenticator: false, passkeys: 1 }}
        description={RECOVERY_CODES_DESCRIPTION}
        onConfirm={acknowledgeRecoveryCodes}
        onClose={() => setPendingRecoveryCodes(null)}
        onRestart={() => setPendingRecoveryCodes(null)}
      />
    </div>
  )
}
