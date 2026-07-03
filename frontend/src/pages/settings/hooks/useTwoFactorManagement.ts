import { useState } from 'react'
import {
  useConfirmRecoveryCodes,
  useDisableTotp,
  useRegenerateRecoveryCodes,
  useTotpStatus,
} from '@/api/twoFactor'
import type { StepUpCredentials } from '@/components/twoFactor/StepUpModal'
import { withMinDelay } from '@/utils/timing'

type TwoFactorModal = 'none' | 'enable' | 'disable' | 'regenerate'

/**
 * Owns the two-factor management state: which modal is open, the disable and regenerate actions,
 * and the freshly regenerated codes shown once after a rotation
 */
export function useTwoFactorManagement() {
  const status = useTotpStatus()
  const disable = useDisableTotp()
  const regenerate = useRegenerateRecoveryCodes()
  const confirmCodes = useConfirmRecoveryCodes()
  const [openModal, setOpenModal] = useState<TwoFactorModal>('none')
  const [regeneratedCodes, setRegeneratedCodes] = useState<string[] | null>(null)

  const isEnabled = status.data?.totp_enabled ?? false

  /**
   * Turns two-factor off after the step-up reauthentication succeeds, by passkey or authenticator code
   */
  async function confirmDisable(credentials: StepUpCredentials) {
    // Hold the spinner for the shared minimum before the modal closes, so a quick disable does not flash
    await withMinDelay(() => disable.mutateAsync(credentials))
    setOpenModal('none')
  }

  /**
   * Stages a fresh batch and reveals it once the step-up succeeds, leaving the active codes live
   */
  async function confirmRegenerate(credentials: StepUpCredentials) {
    // Hold the spinner for the shared minimum before the step-up closes and the codes appear
    const result = await withMinDelay(() => regenerate.mutateAsync(credentials))
    setRegeneratedCodes(result.recovery_codes)
    setOpenModal('none')
  }

  /**
   * Activates the staged batch after the user acknowledges it, then closes the codes modal
   */
  async function acknowledgeRegeneratedCodes() {
    await confirmCodes.mutateAsync()
    setRegeneratedCodes(null)
  }

  return {
    isEnabled,
    isStatusLoading: status.isLoading,
    openModal,
    showEnable: () => setOpenModal('enable'),
    showDisable: () => setOpenModal('disable'),
    showRegenerate: () => setOpenModal('regenerate'),
    closeModal: () => setOpenModal('none'),
    confirmDisable,
    confirmRegenerate,
    regeneratedCodes,
    acknowledgeRegeneratedCodes,
    dismissRegeneratedCodes: () => setRegeneratedCodes(null),
  }
}
