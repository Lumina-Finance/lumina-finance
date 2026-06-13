import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, Upload } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useAuth } from '@/hooks/useAuth'
import { useAccounts } from '@/api/accounts'
import {
  useRunwaySettings,
  useUpdateProfile,
  useUpdateRunwaySettings,
  type UpdateProfilePayload,
} from '@/api/user'
import { useActionFeedback } from '@/hooks/useActionFeedback'
import {
  DEFAULT_RUNWAY_THRESHOLDS,
  normalizeRunwayThresholds,
  type RunwayThresholds,
} from '@/utils/runway'
import CategorySettingsSection from '@/settings/components/CategorySettingsSection'
import MerchantSettingsSection from '@/settings/components/MerchantSettingsSection'
import TagSettingsSection from '@/settings/components/TagSettingsSection'
import ProfileSection from '@/settings/components/ProfileSection'
import RunwaySection from '@/settings/components/RunwaySection'
import { SettingsPaneActions } from '@/settings/components/SettingsPaneActions'
import TaxAdvantagedCategoriesSection from '@/settings/components/tax-advantaged/TaxAdvantagedCategoriesSection'
import { profileFormFromUser, type ProfileFormState } from '@/settings/profileForm'
import { SETTINGS_SECTIONS, type SettingsSectionId } from '@/settings/settingsNavigation'

function runwayThresholdsEqual(a: RunwayThresholds, b: RunwayThresholds) {
  return a.riskyBelowMonths === b.riskyBelowMonths && a.healthyAtMonths === b.healthyAtMonths
}


/* ── Top-level page ── */

export default function SettingsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, setUser } = useAuth()
  const { data: accounts, isLoading: accountsLoading } = useAccounts()
  const { data: runwaySettings, isLoading: runwaySettingsLoading } = useRunwaySettings()
  const updateProfile = useUpdateProfile()
  const updateRunway = useUpdateRunwaySettings()

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
  const runwayServerSet = useMemo(() => new Set(runwaySettings?.accountIds ?? []), [runwaySettings?.accountIds])
  const archivedRunwayServerSet = useMemo(
    () => new Set(runwaySettings?.archivedAccountIds ?? []),
    [runwaySettings?.archivedAccountIds],
  )
  const runwaySelection = runwayDraft ?? runwayServerSet
  // Only open asset accounts are eligible. Credit products (credit cards,
  // lines of credit, HELOCs) are borrowed headroom — treating them as runway
  // inflates the number against real cushion. Loans and mortgages are debt
  // that doesn't contribute either. Liability accounts are excluded outright.
  const selectableAccounts = useMemo(
    () =>
      (accounts ?? []).filter(
        (a) => a.closed_at === null && !a.is_archived && a.account_kind === 'asset',
      ),
    [accounts],
  )
  const archivedRunwayAccounts = useMemo(
    () => (accounts ?? []).filter((account) => archivedRunwayServerSet.has(account.id)),
    [accounts, archivedRunwayServerSet],
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
  const runwayServerThresholds = useMemo(
    () => normalizeRunwayThresholds(runwaySettings?.thresholds ?? DEFAULT_RUNWAY_THRESHOLDS),
    [runwaySettings?.thresholds],
  )
  const [runwayThresholdDraft, setRunwayThresholdDraft] = useState<RunwayThresholds | null>(null)
  const runwayThresholdValues = runwayThresholdDraft ?? runwayServerThresholds
  const isRunwayThresholdDirty = runwayThresholdDraft !== null
  const setRunwayThreshold = (field: keyof RunwayThresholds, value: number) => {
    setRunwayThresholdDraft((prev) => {
      const next = normalizeRunwayThresholds({
        ...(prev ?? runwayServerThresholds),
        [field]: value,
      })
      return runwayThresholdsEqual(next, runwayServerThresholds) ? null : next
    })
  }
  const isRunwayPaneDirty = isRunwayDirty || isRunwayThresholdDirty

  // ── Pane-level save/discard ──
  const profileSaveFeedback = useActionFeedback()
  const runwaySaveFeedback = useActionFeedback()
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const [settingsMenuStuck, setSettingsMenuStuck] = useState(false)
  const mobileSettingsStickySentinelRef = useRef<HTMLDivElement>(null)
  const mobileSettingsMenuRef = useRef<HTMLDivElement>(null)
  const isProfilePending = profileSaveFeedback.isPending || updateProfile.isPending
  const isRunwayPending = runwaySaveFeedback.isPending || updateRunway.isPending
  const canSaveProfile = isProfileDirty && !isProfilePending && firstNameValid
  const canSaveRunway = runwaySettings !== undefined && isRunwayPaneDirty && !isRunwayPending

  const handleSaveProfile = async () => {
    if (!canSaveProfile || !user) return

    try {
      await profileSaveFeedback.run(async () => {
        // Patch only the fields that actually changed. last_name translates ""
        // → null so the backend clears the column instead of storing "".
        const patch: UpdateProfilePayload = {}
        if (profileForm.first_name !== user.first_name) patch.first_name = profileForm.first_name.trim()
        const nextLast = profileForm.last_name === '' ? null : profileForm.last_name
        if (nextLast !== user.last_name) patch.last_name = nextLast
        if (profileForm.tz !== user.tz) patch.tz = profileForm.tz

        const updated = await updateProfile.mutateAsync(patch)
        setUser(updated)
        setProfileOverrides({})
      })
    } catch {
      // Mutation errors surface through the pane-level save error text.
    }
  }

  const handleDiscardProfile = () => {
    setProfileOverrides({})
  }

  const handleSaveRunway = async () => {
    if (!canSaveRunway) return

    try {
      await runwaySaveFeedback.run(async () => {
        await updateRunway.mutateAsync({
          accountIds: Array.from(runwaySelection),
          thresholds: runwayThresholdValues,
        })
        setRunwayDraft(null)
        setRunwayThresholdDraft(null)
      })
    } catch {
      // Mutation errors surface through the pane-level save error text.
    }
  }

  const handleDiscardRunway = () => {
    setRunwayDraft(null)
    setRunwayThresholdDraft(null)
  }

  // ── Scroll-spy navigation ──
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('profile')
  // Suppress the scroll spy while a programmatic scroll is settling,
  // so clicks don't briefly flash the wrong item active.
  const skipScrollSpyRef = useRef(false)

  const navigateToSection = (id: SettingsSectionId) => {
    const el = document.getElementById(id)
    if (!el) return
    skipScrollSpyRef.current = true
    setActiveSection(id)
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => { skipScrollSpyRef.current = false }, 600)
  }

  const navigateFromMobileMenu = (id: SettingsSectionId) => {
    setSettingsMenuOpen(false)
    navigateToSection(id)
  }

  const navigateToImport = () => {
    setSettingsMenuOpen(false)
    navigate('/settings/imports')
  }

  useEffect(() => {
    if (!location.hash) return undefined

    const section = SETTINGS_SECTIONS.find(({ id }) => id === decodeURIComponent(location.hash.slice(1)))
    if (!section) return undefined

    let settleTimer: number | null = null
    const frameId = window.requestAnimationFrame(() => {
      const el = document.getElementById(section.id)
      if (!el) return

      skipScrollSpyRef.current = true
      setActiveSection(section.id)
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      settleTimer = window.setTimeout(() => { skipScrollSpyRef.current = false }, 600)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      if (settleTimer !== null) window.clearTimeout(settleTimer)
    }
  }, [location.hash])

  useEffect(() => {
    let frameId: number | null = null

    const syncActiveSection = () => {
      if (frameId !== null) return

      frameId = window.requestAnimationFrame(() => {
        frameId = null
        if (skipScrollSpyRef.current) return

        const isCompactMenu = window.matchMedia('(max-width: 1199.98px)').matches
        const compactMenuBottom = mobileSettingsMenuRef.current?.getBoundingClientRect().bottom ?? 0
        const activationLine = isCompactMenu
          ? compactMenuBottom + 24
          : Math.min(window.innerHeight * 0.32, 240)
        let nextActiveSection = SETTINGS_SECTIONS[0].id

        for (const section of SETTINGS_SECTIONS) {
          const el = document.getElementById(section.id)
          if (!el) continue
          if (el.getBoundingClientRect().top > activationLine) break
          nextActiveSection = section.id
        }

        setActiveSection((current) => (
          current === nextActiveSection ? current : nextActiveSection
        ))
      })
    }

    syncActiveSection()
    window.addEventListener('scroll', syncActiveSection, { passive: true })
    window.addEventListener('resize', syncActiveSection)
    window.addEventListener('orientationchange', syncActiveSection)

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      window.removeEventListener('scroll', syncActiveSection)
      window.removeEventListener('resize', syncActiveSection)
      window.removeEventListener('orientationchange', syncActiveSection)
    }
  }, [])

  useEffect(() => {
    if (!settingsMenuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (mobileSettingsMenuRef.current?.contains(target)) return
      setSettingsMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [settingsMenuOpen])

  useEffect(() => {
    const sentinel = mobileSettingsStickySentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      ([entry]) => setSettingsMenuStuck(!entry.isIntersecting),
      { threshold: 0 },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  const profileSaveError = updateProfile.isError
    ? ((updateProfile.error as Error)?.message ?? 'Failed to save profile.')
    : null
  const runwaySaveError = updateRunway.isError
    ? ((updateRunway.error as Error)?.message ?? 'Failed to save runway settings.')
    : null
  const profileActions = (
    <SettingsPaneActions
      canSave={canSaveProfile}
      dirty={isProfileDirty}
      error={profileSaveError}
      onDiscard={handleDiscardProfile}
      onSave={handleSaveProfile}
      pending={isProfilePending}
      status={profileSaveFeedback.status}
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
      status={runwaySaveFeedback.status}
    />
  )
  const activeSettingsSection = SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0]
  const ActiveSettingsIcon = activeSettingsSection.icon

  return (
    <div>
      <header className="app-page-header mb-3 min-[1050px]:mb-4 min-[1200px]:mb-6">
        <h1 className="app-page-title">Settings</h1>
        <p className="app-page-description">
          Manage your profile, runway preferences, categories, merchants, tags, and tax-advantaged categories.
        </p>
      </header>

      <div ref={mobileSettingsStickySentinelRef} aria-hidden className="h-px min-[1200px]:hidden" />
      <div className="settings-mobile-section-menu-lock-spacer hidden min-[1200px]:hidden" aria-hidden />

      <div
        className="settings-mobile-section-menu-shell sticky top-0 z-20 -mx-2 -mt-4 mb-4 min-h-[3.75rem] px-2 pt-4 min-[1050px]:-mt-5 min-[1050px]:min-h-16 min-[1050px]:pt-5 min-[1200px]:hidden"
        style={{
          background: 'color-mix(in srgb, var(--app-bg) 72%, transparent)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }}
      >
        <div
          ref={mobileSettingsMenuRef}
          className={`relative transition-[margin-right] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${settingsMenuStuck ? 'max-[1049px]:mr-16' : 'max-[1049px]:mr-0'}`}
        >
          <button
            type="button"
            className="relative flex h-11 w-full items-center gap-3 rounded-xl border px-4 text-left font-medium shadow-sm transition-colors duration-150"
            style={{
              background: 'var(--app-surface-soft)',
              borderColor: 'var(--app-border)',
              color: 'var(--app-text)',
            }}
            aria-expanded={settingsMenuOpen}
            aria-controls="settings-mobile-section-menu"
            onClick={() => setSettingsMenuOpen((open) => !open)}
          >
            <ActiveSettingsIcon size={18} aria-hidden className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{activeSettingsSection.label}</span>
            <ChevronDown
              size={18}
              aria-hidden
              className={`shrink-0 transition-transform duration-200 ${settingsMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>

          <AnimatePresence>
            {settingsMenuOpen && (
              <motion.div
                id="settings-mobile-section-menu"
                initial={{ opacity: 0, y: -6, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.99 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="absolute left-0 right-0 top-[calc(100%+0.5rem)] overflow-hidden rounded-xl border p-1 shadow-lg"
                style={{
                  background: 'var(--app-surface-soft)',
                  borderColor: 'var(--app-border)',
                }}
              >
                <nav className="space-y-0.5" aria-label="Settings sections">
                  {SETTINGS_SECTIONS.map((section) => {
                    const Icon = section.icon
                    const isActive = activeSection === section.id
                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => navigateFromMobileMenu(section.id)}
                        className={`app-nav-link ${isActive ? 'app-nav-link-active' : ''}`}
                      >
                        <Icon size={17} strokeWidth={isActive ? 2 : 1.75} className="shrink-0" aria-hidden />
                        {section.label}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    onClick={navigateToImport}
                    className="app-nav-link"
                  >
                    <Upload size={17} strokeWidth={1.75} className="shrink-0" aria-hidden />
                    Import
                  </button>
                </nav>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="min-[1200px]:grid min-[1200px]:grid-cols-[260px_minmax(0,1fr)] min-[1200px]:gap-10 min-[1200px]:items-start">
        {/* Sidebar — sticky on desktop, hidden on mobile (sections just stack) */}
        <aside className="hidden w-[260px] self-stretch min-[1200px]:grid min-[1200px]:min-h-[calc(100vh-3rem)] min-[1200px]:grid-rows-[auto_minmax(0,1fr)_auto]">
          <nav className="settings-desktop-section-nav sticky top-6 row-start-1 space-y-0.5" aria-label="Settings sections">
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
          <div className="sticky bottom-6 row-start-3">
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
            userInformationActions={profileActions}
            emailPasswordActions={emailPasswordActions}
          />
          <RunwaySection
            loading={accountsLoading || runwaySettingsLoading}
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
