import { useAccounts } from '@/api/accounts'
import CategorySettingsSection from '@/settings/components/CategorySettingsSection'
import MerchantSettingsSection from '@/settings/components/MerchantSettingsSection'
import TagSettingsSection from '@/settings/components/TagSettingsSection'
import ProfileSection from '@/settings/components/ProfileSection'
import RunwaySection from '@/settings/components/RunwaySection'
import {
  SettingsDesktopSectionSidebar,
  SettingsMobileSectionMenu,
} from '@/settings/components/SettingsSectionNavigation'
import { SettingsPaneActions } from '@/settings/components/SettingsPaneActions'
import TaxAdvantagedCategoriesSection from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection'
import { useProfileSettingsForm } from '@/settings/hooks/useProfileSettingsForm'
import { useRunwaySettingsForm } from '@/settings/hooks/useRunwaySettingsForm'
import { useSettingsSectionNavigation } from '@/settings/hooks/useSettingsSectionNavigation'

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
  const emailPasswordActions = (
    <SettingsPaneActions
      canSave={false}
      dirty={false}
      onDiscard={() => undefined}
      onSave={() => undefined}
      pending={false}
      status="idle"
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
          Manage your profile, runway preferences, categories, merchants, tags, and tax-advantaged categories.
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
            emailPasswordActions={emailPasswordActions}
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
