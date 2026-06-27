import { useAccounts } from '@/api/accounts'
import CategorySettingsSection from '@/pages/settings/components/category-settings-section'
import MerchantSettingsSection from '@/pages/settings/components/merchant-settings-section'
import TagSettingsSection from '@/pages/settings/components/tag-settings-section'
import ProfileSection from '@/pages/settings/components/ProfileSection'
import RunwaySection from '@/pages/settings/components/runway-section'
import { StepUpModal } from '@/components/twoFactor/StepUpModal'
import SecuritySection from '@/pages/settings/components/security-section'
import {
  SettingsDesktopSectionSidebar,
  SettingsMobileSectionMenu,
} from '@/pages/settings/components/SectionNavigation'
import { SettingsPaneActions } from '@/pages/settings/components/PaneActions'
import TaxAdvantagedCategoriesSection from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section'
import { useProfileSettingsForm } from '@/pages/settings/hooks/useProfileSettingsForm'
import { useRunwaySettingsForm } from '@/pages/settings/hooks/useRunwaySettingsForm'
import { useSecuritySettingsForm } from '@/pages/settings/hooks/useSecuritySettingsForm'
import { useSettingsSectionNavigation } from '@/pages/settings/hooks/useSettingsSectionNavigation'

export default function SettingsPage() {
  const {
    user,
    profileForm,
    setProfileField,
    firstNameValid,
    isProfileDirty,
    isProfilePending,
    canSaveProfile,
    profileSaveError,
    profileSaveStatus,
    handleSaveProfile,
    handleDiscardProfile,
  } = useProfileSettingsForm()
  const { data: accounts, isLoading: accountsLoading } = useAccounts()
  const {
    runwayLoading,
    selectableAccounts,
    archivedRunwayAccounts,
    runwaySelection,
    runwayThresholdValues,
    setRunwayThreshold,
    toggleRunwayAccount,
    isRunwayPaneDirty,
    isRunwayPending,
    canSaveRunway,
    runwaySaveError,
    runwaySaveStatus,
    handleSaveRunway,
    handleDiscardRunway,
  } = useRunwaySettingsForm({ accounts, accountsLoading })
  const {
    passwordForm,
    setPasswordField,
    newPasswordValid,
    confirmMatches,
    isPasswordDirty,
    isPasswordPending,
    canSavePassword,
    passwordSaveError,
    passwordSaveStatus,
    handleSavePassword,
    handleDiscardPassword,
    isStepUpOpen,
    verifyPasswordStepUp,
    closeStepUp,
  } = useSecuritySettingsForm()
  const sectionNavigation = useSettingsSectionNavigation()

  const profileActions = (
    <SettingsPaneActions
      canSave={canSaveProfile}
      dirty={isProfileDirty}
      error={profileSaveError}
      onDiscard={handleDiscardProfile}
      onSave={handleSaveProfile}
      pending={isProfilePending}
      status={profileSaveStatus}
    />
  )
  const securityActions = (
    <SettingsPaneActions
      canSave={canSavePassword}
      dirty={isPasswordDirty}
      error={passwordSaveError}
      onDiscard={handleDiscardPassword}
      onSave={handleSavePassword}
      pending={isPasswordPending}
      status={passwordSaveStatus}
    />
  )
  const runwayActions = (
    <SettingsPaneActions
      canSave={canSaveRunway}
      dirty={isRunwayPaneDirty}
      error={runwaySaveError}
      onDiscard={handleDiscardRunway}
      onSave={handleSaveRunway}
      pending={isRunwayPending}
      status={runwaySaveStatus}
    />
  )
  return (
    <div>
      <header className="app-page-header mb-3 min-[1050px]:mb-4 min-[1200px]:mb-6">
        <h1 className="app-page-title">Settings</h1>
        <p className="app-page-description">
          Manage your profile, security, runway preferences, categories, merchants, tags, and tax-advantaged categories.
        </p>
      </header>

      <SettingsMobileSectionMenu
        activeSection={sectionNavigation.activeSection}
        activeSettingsSection={sectionNavigation.activeSettingsSection}
        menuOpen={sectionNavigation.settingsMenuOpen}
        menuStuck={sectionNavigation.settingsMenuStuck}
        sentinelRef={sectionNavigation.mobileSettingsStickySentinelRef}
        menuRef={sectionNavigation.mobileSettingsMenuRef}
        onMenuToggle={sectionNavigation.toggleMobileSettingsMenu}
        onSectionSelect={sectionNavigation.navigateFromMobileMenu}
        onImportSelect={sectionNavigation.navigateToImport}
      />

      <div className="min-[1200px]:grid min-[1200px]:grid-cols-[260px_minmax(0,1fr)] min-[1200px]:gap-10 min-[1200px]:items-start">
        <SettingsDesktopSectionSidebar
          activeSection={sectionNavigation.activeSection}
          onSectionSelect={sectionNavigation.navigateToSection}
          onImportSelect={sectionNavigation.navigateToImport}
        />

        <div className="min-w-0 space-y-10">
          <ProfileSection
            user={user}
            form={profileForm}
            onFieldChange={setProfileField}
            firstNameValid={firstNameValid}
            userInformationActions={profileActions}
          />
          <SecuritySection
            email={user?.email ?? ''}
            form={passwordForm}
            onFieldChange={setPasswordField}
            newPasswordValid={newPasswordValid}
            confirmMatches={confirmMatches}
            actions={securityActions}
          />
          <StepUpModal
            open={isStepUpOpen}
            title="Confirm it's you"
            description="Enter your authenticator code to change your password."
            onClose={closeStepUp}
            onVerify={({ code }) => verifyPasswordStepUp(code)}
          />
          <RunwaySection
            loading={runwayLoading}
            accounts={selectableAccounts}
            archivedAccounts={archivedRunwayAccounts}
            selection={runwaySelection}
            onToggle={toggleRunwayAccount}
            thresholds={runwayThresholdValues}
            onThresholdChange={setRunwayThreshold}
            actions={runwayActions}
          />

          <CategorySettingsSection />

          <MerchantSettingsSection />

          <TagSettingsSection />

          <TaxAdvantagedCategoriesSection
            accounts={accounts ?? []}
            userBaseCurrency={user?.base_currency}
            userTimezone={user?.tz}
          />
        </div>
      </div>
    </div>
  )
}
