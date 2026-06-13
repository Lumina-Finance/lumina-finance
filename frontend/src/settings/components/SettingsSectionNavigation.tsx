import type { RefObject } from 'react'
import { ChevronDown, Upload } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import {
  SETTINGS_SECTIONS,
  type SettingsSection,
  type SettingsSectionId,
} from '@/settings/settingsNavigation'

type SettingsSectionButtonProps = {
  section: SettingsSection
  activeSection: SettingsSectionId
  onSelect: (id: SettingsSectionId) => void
}

type SettingsMobileSectionMenuProps = {
  activeSection: SettingsSectionId
  activeSettingsSection: SettingsSection
  menuOpen: boolean
  menuStuck: boolean
  sentinelRef: RefObject<HTMLDivElement | null>
  menuRef: RefObject<HTMLDivElement | null>
  onMenuToggle: () => void
  onSectionSelect: (id: SettingsSectionId) => void
  onImportSelect: () => void
}

type SettingsDesktopSectionSidebarProps = {
  activeSection: SettingsSectionId
  onSectionSelect: (id: SettingsSectionId) => void
  onImportSelect: () => void
}

/**
 * Renders one settings navigation row with the section icon and active state
 */
function SettingsSectionButton({
  section,
  activeSection,
  onSelect,
}: SettingsSectionButtonProps) {
  const Icon = section.icon
  const isActive = activeSection === section.id

  return (
    <button
      type="button"
      onClick={() => onSelect(section.id)}
      className={`app-nav-link ${isActive ? 'app-nav-link-active' : ''}`}
    >
      <Icon size={17} strokeWidth={isActive ? 2 : 1.75} className="shrink-0" aria-hidden />
      {section.label}
    </button>
  )
}

/**
 * Renders the sticky compact settings section menu
 */
export function SettingsMobileSectionMenu({
  activeSection,
  activeSettingsSection,
  menuOpen,
  menuStuck,
  sentinelRef,
  menuRef,
  onMenuToggle,
  onSectionSelect,
  onImportSelect,
}: SettingsMobileSectionMenuProps) {
  const ActiveSettingsIcon = activeSettingsSection.icon

  return (
    <>
      <div ref={sentinelRef} aria-hidden className="h-px min-[1200px]:hidden" />
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
          ref={menuRef}
          className={`relative transition-[margin-right] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${menuStuck ? 'max-[1049px]:mr-16' : 'max-[1049px]:mr-0'}`}
        >
          <button
            type="button"
            className="relative flex h-11 w-full items-center gap-3 rounded-xl border px-4 text-left font-medium shadow-sm transition-colors duration-150"
            style={{
              background: 'var(--app-surface-soft)',
              borderColor: 'var(--app-border)',
              color: 'var(--app-text)',
            }}
            aria-expanded={menuOpen}
            aria-controls="settings-mobile-section-menu"
            onClick={onMenuToggle}
          >
            <ActiveSettingsIcon size={18} aria-hidden className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{activeSettingsSection.label}</span>
            <ChevronDown
              size={18}
              aria-hidden
              className={`shrink-0 transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`}
            />
          </button>

          <AnimatePresence>
            {menuOpen && (
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
                  {SETTINGS_SECTIONS.map((section) => (
                    <SettingsSectionButton
                      key={section.id}
                      section={section}
                      activeSection={activeSection}
                      onSelect={onSectionSelect}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={onImportSelect}
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
    </>
  )
}

/**
 * Renders the desktop settings section sidebar
 */
export function SettingsDesktopSectionSidebar({
  activeSection,
  onSectionSelect,
  onImportSelect,
}: SettingsDesktopSectionSidebarProps) {
  return (
    <aside className="hidden w-[260px] self-stretch min-[1200px]:grid min-[1200px]:min-h-[calc(100vh-3rem)] min-[1200px]:grid-rows-[auto_minmax(0,1fr)_auto]">
      <nav className="settings-desktop-section-nav sticky top-6 row-start-1 space-y-0.5" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((section) => (
          <SettingsSectionButton
            key={section.id}
            section={section}
            activeSection={activeSection}
            onSelect={onSectionSelect}
          />
        ))}
      </nav>
      <div className="sticky bottom-6 row-start-3">
        <button
          type="button"
          onClick={onImportSelect}
          className="app-nav-link"
        >
          <Upload size={17} strokeWidth={1.75} className="shrink-0" aria-hidden />
          Import
        </button>
      </div>
    </aside>
  )
}
