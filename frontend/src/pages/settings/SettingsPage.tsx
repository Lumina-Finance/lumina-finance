import { useAccounts } from '@/api/accounts'
import { useBankProviders } from '@/api/bank-sync'
import { useOidcIdentities } from '@/api/oidc'
import { BankConnectionsSection } from '@/pages/settings/components/bank-connections-section/Section'
import CategorySettingsSection from '@/pages/settings/components/category-settings-section/Section'
import MerchantSettingsSection from '@/pages/settings/components/merchant-settings-section/Section'
import TagSettingsSection from '@/pages/settings/components/tag-settings-section/Section'
import ProfileSection from '@/pages/settings/components/ProfileSection'
import RunwaySection from '@/pages/settings/components/runway-section/Section'
import { StepUpModal } from '@/components/two-factor/StepUpModal'
import SecuritySection from '@/pages/settings/components/security-section/Section'
import { SettingsDesktopSectionSidebar, SettingsMobileSectionMenu } from '@/pages/settings/components/SectionNavigation'
import { SettingsPaneActions } from '@/pages/settings/components/PaneActions'
import TaxAdvantagedCategoriesSection from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/Section'
import { useProfileSettingsForm } from '@/pages/settings/hooks/useProfileSettingsForm'
import { useRunwaySettingsForm } from '@/pages/settings/hooks/useRunwaySettingsForm'
import { useSecuritySettingsForm } from '@/pages/settings/hooks/useSecuritySettingsForm'
import { useSettingsSectionNavigation } from '@/pages/settings/hooks/useSettingsSectionNavigation'
import { listSettingsSections } from '@/pages/settings/settingsNavigation'

/**
 * Settings page gathering the profile, security, runway, bank connection, category, merchant, tag,
 * and tax-advantaged panes behind one section navigation
 *
 * Bank connections are left out, section and navigation entry alike, for a user the bank-linking
 * check refuses
 *
 * Each pane keeps its own draft, dirty state, and save controls, so saving or discarding one
 * pane leaves the edits in the others alone
 */
export default function SettingsPage() {
  const {
    user,
    profileForm,
    setProfileField,
    firstNameValid,
    isProfileDirty,
    isProfilePending,
    canSaveProfile,
    profileSaveBlockedReason,
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
    passwordSaveBlockedReason,
    passwordSaveError,
    passwordSaveStatus,
    handleSavePassword,
    handleDiscardPassword,
    isStepUpOpen,
    verifyPasswordStepUp,
    closeStepUp,
  } = useSecuritySettingsForm()
  const oidcIdentities = useOidcIdentities()
  // Assume a password until the identities load, so the change-password form is the default view
  const hasPassword = oidcIdentities.data?.has_password ?? true
  const { data: bankProviders } = useBankProviders()
  const sections = listSettingsSections(bankProviders)
  const sectionNavigation = useSettingsSectionNavigation(sections)
  const showBankConnections = sections.some((section) => section.id === 'bank-connections')

  const profileActions = (
    <SettingsPaneActions
      canSave={canSaveProfile}
      saveBlockedReason={profileSaveBlockedReason}
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
      saveBlockedReason={passwordSaveBlockedReason}
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
        sections={sections}
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
          sections={sections}
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
            hasPassword={hasPassword}
            actions={securityActions}
          />
          <StepUpModal
            open={isStepUpOpen}
            title="Confirm it's you"
            description="Confirm it's you to change your password."
            allowPasskey
            onClose={closeStepUp}
            onVerify={verifyPasswordStepUp}
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

          {showBankConnections && <BankConnectionsSection />}

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
