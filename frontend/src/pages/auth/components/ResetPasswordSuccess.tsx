type ResetPasswordSuccessProps = {
  /** How many linked sign-in providers the reset also removed from the account */
  signInProvidersRemoved: number
  onGoToLogin: () => void
}

/**
 * Tells the user their password is reset, adding that their linked sign-in providers were removed
 * when the reset removed any, worded for one provider or several. The two lines sit close together
 * as one message, with the view's own spacing setting the button apart
 */
export function ResetPasswordSuccess({ signInProvidersRemoved, onGoToLogin }: ResetPasswordSuccessProps) {
  return (
    <>
      <div className="space-y-2 text-sm" style={{ color: 'var(--app-text-muted)' }}>
        <p>Your password has been reset. You can now log in with your new password.</p>
        {signInProvidersRemoved === 1 && (
          <p>Your linked sign-in provider was removed. You can link it again in Settings.</p>
        )}
        {signInProvidersRemoved > 1 && (
          <p>Your linked sign-in providers were removed. You can link them again in Settings.</p>
        )}
      </div>
      <button
        type="button"
        onClick={onGoToLogin}
        className="font-medium underline underline-offset-2"
        style={{ color: 'var(--app-accent)' }}
      >
        Go to login
      </button>
    </>
  )
}
