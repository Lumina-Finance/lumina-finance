import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAccounts } from '@/api/accounts'
import {
  useRunwayAccounts,
  useUpdateProfile,
  useUpdateRunwayAccounts,
  type UpdateProfilePayload,
} from '@/api/user'
import ActionFeedbackButton from '@/components/ActionFeedbackButton'
import { useActionFeedback } from '@/hooks/useActionFeedback'
import CategorySettingsSection from '@/settings/components/CategorySettingsSection'
import MerchantSettingsSection from '@/settings/components/MerchantSettingsSection'
import TagSettingsSection from '@/settings/components/TagSettingsSection'
import ProfileSection from '@/settings/components/ProfileSection'
import RunwaySection from '@/settings/components/RunwaySection'
import TaxAdvantagedCategoriesSection from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection'
import { profileFormFromUser, type ProfileFormState } from '@/settings/profileForm'
import { SETTINGS_SECTIONS, type SettingsSectionId } from '@/settings/settingsNavigation'


/* ── Top-level page ── */

export default function SettingsPage() {
  const navigate = useNavigate()
  const { user, setUser } = useAuth()
  const { data: accounts, isLoading: accountsLoading } = useAccounts()
  const { data: serverSelection, isLoading: selectionLoading } = useRunwayAccounts()
  const updateProfile = useUpdateProfile()
  const updateRunway = useUpdateRunwayAccounts()

  // ── Profile draft ──
  // Effective form value = base (from user) + overrides. Derived on every
  // render so when `user` updates after save, the form auto-resets with no
  // effect-based sync.
  const [profileOverrides, setProfileOverrides] = useState<Partial<ProfileFormState>>({})
  const profileBase: ProfileFormState = user
    ? profileFormFromUser(user)
    : { first_name: '', last_name: '', tz: '' }
  const profileForm: ProfileFormState = { ...profileBase, ...profileOverrides }
  const setProfileField = <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) =>
    setProfileOverrides((o) => ({ ...o, [key]: value }))

  const isProfileDirty = user
    ? profileForm.first_name !== user.first_name
      || (profileForm.last_name === '' ? null : profileForm.last_name) !== user.last_name
      || profileForm.tz !== user.tz
    : false
  // first_name is required on the backend (min_length=1) — block a blank save
  // client-side so the Save button disables instead of round-tripping a 422.
  const firstNameValid = profileForm.first_name.trim().length > 0

  // ── Runway selection ──
  // `null` means "use the persisted server selection"; once the user flips any
  // tile, keep a local override until Save or Discard resolves it.
  const [runwayDraft, setRunwayDraft] = useState<Set<string> | null>(null)
  const runwayServerSet = useMemo(() => new Set(serverSelection ?? []), [serverSelection])
  const runwaySelection = runwayDraft ?? runwayServerSet
  // Only open asset accounts are eligible. Credit products (credit cards,
  // lines of credit, HELOCs) are borrowed headroom — treating them as runway
  // inflates the number against real cushion. Loans and mortgages are debt
  // that doesn't contribute either. Liability accounts are excluded outright.
  const selectableAccounts = useMemo(
    () =>
      (accounts ?? []).filter(
        (a) => a.closed_at === null && !a.is_hidden && a.account_kind === 'asset',
      ),
    [accounts],
  )
  const toggleRunwayAccount = (id: string) => {
    setRunwayDraft((prev) => {
      const next = new Set(prev ?? runwayServerSet)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const isRunwayDirty = useMemo(() => {
    if (!runwayDraft) return false
    if (runwayDraft.size !== runwayServerSet.size) return true
    for (const id of runwayDraft) if (!runwayServerSet.has(id)) return true
    return false
  }, [runwayDraft, runwayServerSet])

  // ── Combined save/discard ──
  const saveFeedback = useActionFeedback()
  const saveStatus = saveFeedback.status
  const isDirty = isProfileDirty || isRunwayDirty
  const isPending = saveFeedback.isPending
  const canSave = isDirty && !isPending && (!isProfileDirty || firstNameValid)

  const handleSave = async () => {
    if (!canSave || !user) return

    try {
      await saveFeedback.run(async () => {
        const requests: Promise<unknown>[] = []

        if (isProfileDirty) {
          // Patch only the fields that actually changed. last_name translates ""
          // → null so the backend clears the column instead of storing "".
          const patch: UpdateProfilePayload = {}
          if (profileForm.first_name !== user.first_name) patch.first_name = profileForm.first_name.trim()
          const nextLast = profileForm.last_name === '' ? null : profileForm.last_name
          if (nextLast !== user.last_name) patch.last_name = nextLast
          if (profileForm.tz !== user.tz) patch.tz = profileForm.tz

          requests.push(
            updateProfile.mutateAsync(patch).then((updated) => {
              setUser(updated)
              setProfileOverrides({})
            }),
          )
        }

        if (isRunwayDirty && runwayDraft) {
          requests.push(
            updateRunway.mutateAsync(Array.from(runwayDraft)).then(() => {
              setRunwayDraft(null)
            }),
          )
        }

        const results = await Promise.allSettled(requests)
        const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (failed) throw failed.reason
      })
    } catch {
      // Mutation errors already surface through the existing save error text.
    }
  }

  const handleDiscard = () => {
    setProfileOverrides({})
    setRunwayDraft(null)
  }

  // ── Scroll-spy sidebar ──
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('profile')
  // Suppress the IntersectionObserver while a programmatic scroll is settling,
  // so clicks don't briefly flash the wrong item active.
  const skipObserverRef = useRef(false)

  const navigateToSection = (id: SettingsSectionId) => {
    const el = document.getElementById(id)
    if (!el) return
    skipObserverRef.current = true
    setActiveSection(id)
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => { skipObserverRef.current = false }, 600)
  }

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (skipObserverRef.current) return
        const topVisible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (topVisible) setActiveSection(topVisible.target.id as SettingsSectionId)
      },
      { root: null, rootMargin: '-20% 0px -55% 0px', threshold: [0.2, 0.4, 0.6] },
    )

    SETTINGS_SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  // Pick whichever save-path failed to surface above the buttons. Both at
  // once is rare (independent endpoints, parallel mutations) but we still
  // render profile first if present.
  const saveError = updateProfile.isError
    ? ((updateProfile.error as Error)?.message ?? 'Failed to save profile.')
    : updateRunway.isError
      ? ((updateRunway.error as Error)?.message ?? 'Failed to save runway selection.')
      : null

  const saveControls = (
    <div className="space-y-2">
      {saveError && (
        <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
          {saveError}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="app-secondary-button"
          onClick={handleDiscard}
          disabled={!isDirty || isPending}
        >
          Discard
        </button>
        <ActionFeedbackButton
          type="button"
          className="app-primary-button w-[72px]"
          onClick={handleSave}
          disabled={!canSave && saveStatus === 'idle'}
          loadingLabel="Saving"
          status={saveStatus}
        >
          Save
        </ActionFeedbackButton>
      </div>
    </div>
  )

  return (
    <div>
      <header className="app-page-header">
        <h1 className="app-page-title">Settings</h1>
        <p className="app-page-description">
          Manage your profile, runway preferences, categories, merchants, tags, and tax-advantaged categories.
        </p>
      </header>

      <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10 lg:items-start">
        {/* Sidebar — sticky on desktop, hidden on mobile (sections just stack) */}
        <aside className="hidden lg:block sticky top-6">
          <nav className="space-y-0.5" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((s) => {
              const Icon = s.icon
              const isActive = activeSection === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => navigateToSection(s.id)}
                  className={`app-nav-link ${isActive ? 'app-nav-link-active' : ''}`}
                >
                  <Icon size={17} strokeWidth={isActive ? 2 : 1.75} className="shrink-0" aria-hidden />
                  {s.label}
                </button>
              )
            })}

          </nav>
          <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--app-border)' }}>
            {saveControls}
          </div>
          <div className="fixed bottom-6 left-[calc(260px+1.5rem)] w-[260px]">
            <button
              type="button"
              onClick={() => navigate('/settings/imports')}
              className="app-nav-link"
            >
              <Upload size={17} strokeWidth={1.75} className="shrink-0" aria-hidden />
              Import
            </button>
          </div>
        </aside>

        <div className="min-w-0 space-y-10">
          <ProfileSection
            user={user}
            form={profileForm}
            onFieldChange={setProfileField}
            firstNameValid={firstNameValid}
          />
          <RunwaySection
            loading={accountsLoading || selectionLoading}
            accounts={selectableAccounts}
            selection={runwaySelection}
            onToggle={toggleRunwayAccount}
          />

          <CategorySettingsSection />

          <MerchantSettingsSection />

          <TagSettingsSection />

          <TaxAdvantagedCategoriesSection
            accounts={accounts ?? []}
            userBaseCurrency={user?.base_currency}
            userTimezone={user?.tz}
          />

          {/* Unified save bar — covers both profile + runway in parallel */}
          <div className="pt-2 lg:hidden">
            {saveControls}
          </div>
        </div>
      </div>
    </div>
  )
}
