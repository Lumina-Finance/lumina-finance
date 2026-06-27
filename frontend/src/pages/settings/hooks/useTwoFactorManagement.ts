import { useState } from 'react'
import { useDisableTotp, useRegenerateRecoveryCodes, useTotpStatus } from '@/api/twoFactor'
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
   * Rotates the recovery codes, then reveals the new batch once the step-up succeeds
   */
  async function confirmRegenerate({ password, code }: StepUpCredentials) {
    const result = await regenerate.mutateAsync({ password, code })
    setRegeneratedCodes(result.recovery_codes)
    setOpenModal('none')
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
    dismissRegeneratedCodes: () => setRegeneratedCodes(null),
  }
}
