import { useState } from 'react'
import { ApiError } from '@/api/auth'
import { usePasskeys } from '@/api/passkeys'
import { useTotpStatus } from '@/api/two-factor'
import { useChangePassword } from '@/api/user'
import type { StepUpCredentials } from '@/components/two-factor/StepUpModal'
import { useActionFeedback } from '@/hooks/useActionFeedback'
import { buildLockoutWarning, getAttemptsRemaining } from '@/utils/lockoutWarning'
import { isNewPasswordValid } from '@/utils/passwordPolicy'

export interface PasswordFormState {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

const emptyPasswordForm: PasswordFormState = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
}

/**
 * Maps a change-password failure to a message that tells the user which field to fix
 *
 * The endpoint returns 401 when the current password is wrong and 422 when the new
 * password fails the policy, so the status drives the message rather than the raw detail
 */
function getChangePasswordErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    // A wrong current password shares the login lockout, so warn how close it is to signing the user out
    const remaining = getAttemptsRemaining(error)
    const incorrect = 'Your current password is incorrect'
    return remaining !== null ? `${incorrect}. ${buildLockoutWarning(remaining)}` : incorrect
  }
  if (error instanceof ApiError && error.status === 422) {
    return 'Your new password does not meet the requirements'
  }
  return 'Failed to change password'
}

/**
 * Owns password-change draft state, policy validation, mutation feedback, and save actions
 */
export function useSecuritySettingsForm() {
  const changePassword = useChangePassword()
  const passwordFeedback = useActionFeedback()
  const totpStatus = useTotpStatus()
  const passkeys = usePasskeys()

  // Any active second factor gates a password change behind a step-up, so a passkey-only account is
  // protected the same as a TOTP one
  const hasSecondFactor = (totpStatus.data?.totp_enabled ?? false) || (passkeys.data?.length ?? 0) > 0
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>(emptyPasswordForm)
  const [isStepUpOpen, setIsStepUpOpen] = useState(false)

  const newPasswordValid = isNewPasswordValid(passwordForm.newPassword)
  const confirmMatches = passwordForm.confirmPassword === passwordForm.newPassword
  const currentPasswordFilled = passwordForm.currentPassword.length > 0

  // A password form has no backend base to diff against, so any filled field counts as dirty
  const isPasswordDirty =
    currentPasswordFilled || passwordForm.newPassword.length > 0 || passwordForm.confirmPassword.length > 0
  const isPasswordPending = passwordFeedback.isPending || changePassword.isPending
  const canSavePassword =
    isPasswordDirty && !isPasswordPending && currentPasswordFilled && newPasswordValid && confirmMatches
  const passwordSaveError = changePassword.isError
    ? getChangePasswordErrorMessage(changePassword.error)
    : null

  /**
   * Applies a single password field change to the draft
   */
  function setPasswordField<K extends keyof PasswordFormState>(key: K, value: string) {
    setPasswordForm((form) => ({ ...form, [key]: value }))
  }

  /**
   * Changes the password and clears the draft only after the change succeeds
   *
   * The optional credentials carry the second factor required when one is active, a passkey or a code
   */
  async function submitPasswordChange(credentials?: StepUpCredentials) {
    await passwordFeedback.run(async () => {
      await changePassword.mutateAsync({
        current_password: passwordForm.currentPassword,
        new_password: passwordForm.newPassword,
        code: credentials?.code,
        passkey: credentials?.passkey,
      })
      setPasswordForm(emptyPasswordForm)
      setIsStepUpOpen(false)
    })
  }

  /**
   * Saves directly, or opens the step-up modal first when a second factor is active
   */
  async function handleSavePassword() {
    if (!canSavePassword) return

    if (hasSecondFactor) {
      setIsStepUpOpen(true)
      return
    }

    try {
      await submitPasswordChange()
    } catch {
      // Mutation errors surface through the pane-level save error text
    }
  }

  /**
   * Completes the password change from the step-up modal, keeping the failure on the modal so the
   * pane does not show a misleading current-password error
   */
  async function verifyPasswordStepUp(credentials: StepUpCredentials) {
    try {
      await submitPasswordChange(credentials)
    } catch (error) {
      changePassword.reset()
      throw error
    }
  }

  /**
   * Dismisses the step-up modal without changing the password
   */
  function closeStepUp() {
    setIsStepUpOpen(false)
  }

  /**
   * Clears the password draft without contacting the backend
   */
  function handleDiscardPassword() {
    setPasswordForm(emptyPasswordForm)
  }

  return {
    passwordForm,
    setPasswordField,
    newPasswordValid,
    confirmMatches,
    isPasswordDirty,
    isPasswordPending,
    canSavePassword,
    passwordSaveError,
    passwordSaveStatus: passwordFeedback.status,
    handleSavePassword,
    handleDiscardPassword,
    isStepUpOpen,
    verifyPasswordStepUp,
    closeStepUp,
  }
}
