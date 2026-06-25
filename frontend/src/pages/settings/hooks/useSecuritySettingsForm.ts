import { useState } from 'react'
import { ApiError } from '@/api/auth'
import { useChangePassword } from '@/api/user'
import { useActionFeedback } from '@/hooks/useActionFeedback'
import { isNewPasswordValid } from '@/pages/settings/components/security-section/passwordPolicy'

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
    return 'Your current password is incorrect'
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
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>(emptyPasswordForm)

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
   */
  async function handleSavePassword() {
    if (!canSavePassword) return

    try {
      await passwordFeedback.run(async () => {
        await changePassword.mutateAsync({
          current_password: passwordForm.currentPassword,
          new_password: passwordForm.newPassword,
        })
        setPasswordForm(emptyPasswordForm)
      })
    } catch {
      // Mutation errors surface through the pane-level save error text
    }
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
  }
}
