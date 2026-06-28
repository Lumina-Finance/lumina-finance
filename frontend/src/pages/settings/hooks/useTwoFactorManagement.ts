import { useState } from 'react'
import {
  useConfirmRecoveryCodes,
  useDisableTotp,
  useRegenerateRecoveryCodes,
  useTotpStatus,
} from '@/api/twoFactor'
import type { StepUpCredentials } from '@/components/twoFactor/StepUpModal'

type TwoFactorModal = 'none' | 'manage' | 'enable' | 'disable' | 'regenerate'

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
   * Turns two-factor off after the step-up reauthentication succeeds
   */
  async function confirmDisable({ password, code }: StepUpCredentials) {
    await disable.mutateAsync({ password, code })
    setOpenModal('none')
  }

  /**
   * Stages a fresh batch and reveals it once the step-up succeeds, leaving the active codes live
   */
  async function confirmRegenerate({ password, code }: StepUpCredentials) {
    const result = await regenerate.mutateAsync({ password, code })
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
    showManage: () => setOpenModal('manage'),
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
