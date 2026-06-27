import { ManageTwoFactorDialog } from '@/components/twoFactor/ManageTwoFactorDialog'
import { RecoveryCodesModal } from '@/components/twoFactor/RecoveryCodesModal'
import { StepUpModal } from '@/components/twoFactor/StepUpModal'
import { TotpEnrollmentModal } from '@/components/twoFactor/TotpEnrollmentModal'
import { useTwoFactorManagement } from '@/pages/settings/hooks/useTwoFactorManagement'

const BADGE_BASE_CLASS = 'rounded-full px-2 py-0.5 text-xs font-medium'

const ENABLED_BADGE_STYLE = {
  backgroundColor: 'var(--app-positive-soft)',
  color: 'var(--app-positive)',
}

const OFF_BADGE_STYLE = {
  borderColor: 'var(--app-border)',
  color: 'var(--app-text-subtle)',
}

/**
 * Shows whether two-factor is on as a status badge, with a single Manage button that opens the hub
 * dialog. Lives inside the security card alongside the email and password fields
 */
export default function TwoFactorControls() {
  const {
    isEnabled,
    isStatusLoading,
    openModal,
    showManage,
    showEnable,
    showDisable,
    showRegenerate,
    closeModal,
    confirmDisable,
    confirmRegenerate,
    regeneratedCodes,
    dismissRegeneratedCodes,
  } = useTwoFactorManagement()

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">Two-factor authentication</h3>
            {!isStatusLoading && (
              <span
                className={isEnabled ? BADGE_BASE_CLASS : `${BADGE_BASE_CLASS} border`}
                style={isEnabled ? ENABLED_BADGE_STYLE : OFF_BADGE_STYLE}
              >
                {isEnabled ? 'Enabled' : 'Off'}
              </span>
            )}
          </div>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            A one-time code from an authenticator app when you sign in.
          </p>
        </div>

        <button
          type="button"
          onClick={showManage}
          disabled={isStatusLoading}
          className="app-secondary-button shrink-0"
        >
          Manage
        </button>
      </div>

      <ManageTwoFactorDialog
        open={openModal === 'manage'}
        isEnabled={isEnabled}
        onClose={closeModal}
        onSetUp={showEnable}
        onRegenerate={showRegenerate}
        onDisable={showDisable}
      />

      <TotpEnrollmentModal open={openModal === 'enable'} onClose={closeModal} />

      <StepUpModal
        open={openModal === 'disable'}
        title="Turn off two-factor authentication"
        description="Enter your password and a current code to turn two-factor off."
        requirePassword
        confirmLabel="Turn off"
        danger
        onClose={closeModal}
        onVerify={confirmDisable}
      />

      <StepUpModal
        open={openModal === 'regenerate'}
        title="Regenerate recovery codes"
        description="Enter your password and a current code to replace your recovery codes."
        requirePassword
        confirmLabel="Regenerate"
        onClose={closeModal}
        onVerify={confirmRegenerate}
      />

      <RecoveryCodesModal
        open={regeneratedCodes !== null}
        codes={regeneratedCodes}
        onClose={dismissRegeneratedCodes}
      />
    </>
  )
}
