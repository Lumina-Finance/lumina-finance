import { useId, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { AcknowledgementGroup } from '@/components/forms/AcknowledgementGroup'
import {
  getAcknowledgementItemId,
  getAcknowledgementProblem,
  getFirstUntickedKey,
} from '@/components/forms/acknowledgement'
import { FormError } from '@/components/forms/FormError'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { RecoveryCodesPanel, type RecoveryFactors } from '@/components/two-factor/RecoveryCodesPanel'
import { SetupRestart } from '@/components/two-factor/SetupRestart'
import { ModalContentFooter, ModalContentPanel } from '@/components/modal/ContentPanel'
import { MODAL_TITLE_CLASS_NAME } from '@/components/modal/Rail'
import type { ModalLevel } from '@/components/modal/Shell'
import { SERVER_UNREACHABLE_MESSAGE } from '@/api/server'
import { isSetupRefused } from '@/utils/setupFailure'
import { delayToMinimum } from '@/utils/timing'

const DEFAULT_DESCRIPTION =
  "These replace your current codes once you confirm. Store them somewhere safe, you won't see them again."

const ACK_FIELDS = ['acknowledgements'] as const
const ACK_KEYS = ['saved', 'lockout'] as const

type RecoveryCodesModalProps = {
  open: boolean
  codes: string[] | null
  /** The factors this batch covers, named in the lockout warning */
  factors: RecoveryFactors
  /** Activates the staged batch once acknowledged, the parent closes the modal on success */
  onConfirm: () => Promise<void>
  /** Dismisses without activating, leaving the current codes in force */
  onClose: () => void
  /** Drops this batch and begins the step that issued it again, since a refused confirm can't be retried */
  onRestart: () => void
  /** Overrides the body text, since first-time issuance reads differently from a rotation */
  description?: string
  /** Set to stacked where this opens over the multi-factor modal rather than straight from a page */
  level?: ModalLevel
}

/**
 * Reveals a freshly staged batch of recovery codes and only swaps them in once the user acknowledges
 * them, so closing without confirming leaves the existing codes working
 */
export function RecoveryCodesModal({
  open,
  codes,
  factors,
  onConfirm,
  onClose,
  onRestart,
  description = DEFAULT_DESCRIPTION,
  level = 'page',
}: RecoveryCodesModalProps) {
  const [acknowledged, setAcknowledged] = useState(false)
  const [lockoutAcknowledged, setLockoutAcknowledged] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState('')

  const groupId = useId()
  const refusal = useRefusedSubmit(
    { acknowledgements: getAcknowledgementProblem([acknowledged, lockoutAcknowledged]) },
    ACK_FIELDS,
    {
      acknowledgements: getAcknowledgementItemId(
        groupId,
        getFirstUntickedKey(ACK_KEYS, [acknowledged, lockoutAcknowledged]),
      ),
    },
  )

  // The component stays mounted between rotations, so reset transient state on each close
  const reset = () => {
    refusal.reset()
    setAcknowledged(false)
    setLockoutAcknowledged(false)
    setConfirming(false)
    setFailed(false)
    setError('')
  }

  /**
   * Activates the staged codes, offering a fresh start once the server refuses them and another try
   * when the request got no usable answer
   */
  const handleConfirm = async () => {
    if (confirming || !refusal.guard()) return

    setError('')
    setConfirming(true)
    const start = Date.now()
    try {
      await onConfirm()
      await delayToMinimum(start)
      reset()
    } catch (failure) {
      await delayToMinimum(start)
      if (isSetupRefused(failure)) setFailed(true)
      else setError(SERVER_UNREACHABLE_MESSAGE)
      setConfirming(false)
    }
  }

  /**
   * Resets the transient state as the modal closes
   */
  const handleClose = () => {
    reset()
    onClose()
  }

  /**
   * Resets the transient state and hands back to the parent to issue a new batch
   */
  const handleStartAgain = () => {
    reset()
    onRestart()
  }

  return (
    <ModalContentPanel
      open={open}
      onClose={handleClose}
      closeDisabled={confirming}
      titleId="recovery-codes-title"
      level={level}
      RailIcon={KeyRound}
      railLabel="Recovery"
    >
      <div className="space-y-1">
        <h3 id="recovery-codes-title" className={MODAL_TITLE_CLASS_NAME}>
          Your new recovery codes
        </h3>
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          {description}
        </p>
      </div>

      {codes && <RecoveryCodesPanel codes={codes} factors={factors} />}

      <AcknowledgementGroup
        groupId={groupId}
        heading="Before you continue"
        error={refusal.errors.acknowledgements}
        errorId={`${groupId}-error`}
        items={[
          {
            key: 'saved',
            label: "I've saved my new recovery codes",
            checked: acknowledged,
            onChange: setAcknowledged,
          },
          {
            key: 'lockout',
            label:
              'I understand that losing my recovery codes and my passkey or authenticator at the same time may permanently lock me out of my account',
            checked: lockoutAcknowledged,
            onChange: setLockoutAcknowledged,
            multiline: true,
          },
        ]}
      />

      <ModalContentFooter>
        {failed ? (
          <SetupRestart onStartAgain={handleStartAgain} />
        ) : (
          <div className="space-y-3">
            <FormError message={error} className="text-center" />
            <div className="flex justify-center">
              <DisabledReasonButton
                onClick={handleConfirm}
                disabled={confirming}
                disabledReason={confirming ? undefined : refusal.blockedReason}
                className={`app-primary-button ${confirming ? 'app-primary-button-loading' : 'w-full'}`}
              >
                {confirming ? <div className="app-spinner" /> : 'Done'}
              </DisabledReasonButton>
            </div>
          </div>
        )}
      </ModalContentFooter>
    </ModalContentPanel>
  )
}
