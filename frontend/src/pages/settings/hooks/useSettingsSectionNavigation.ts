import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { SETTINGS_SECTIONS, type SettingsSectionId } from '@/pages/settings/settingsNavigation'

const PROGRAMMATIC_SCROLL_SETTLE_MS = 600

/**
 * Owns settings section scroll spy state, mobile menu state, and section navigation
 */
export function useSettingsSectionNavigation() {
  const navigate = useNavigate()
  const location = useLocation()
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('profile')
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const [settingsMenuStuck, setSettingsMenuStuck] = useState(false)
  const mobileSettingsStickySentinelRef = useRef<HTMLDivElement>(null)
  const mobileSettingsMenuRef = useRef<HTMLDivElement>(null)
  const skipScrollSpyRef = useRef(false)

  /**
   * Scrolls to a section while suppressing scroll-spy updates during the smooth-scroll settle window
   */
  function navigateToSection(id: SettingsSectionId) {
    const element = document.getElementById(id)
    if (!element) return

    skipScrollSpyRef.current = true
    setActiveSection(id)
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => { skipScrollSpyRef.current = false }, PROGRAMMATIC_SCROLL_SETTLE_MS)
  }

  /**
   * Closes the compact menu before navigating so the sticky menu does not cover the target section
   */
  function navigateFromMobileMenu(id: SettingsSectionId) {
    setSettingsMenuOpen(false)
    navigateToSection(id)
  }

  /**
   * Routes to imports from either settings navigation surface
   */
  function navigateToImport() {
    setSettingsMenuOpen(false)
    navigate('/settings/imports')
  }

  /**
   * Toggles the compact section menu from the trigger button
   */
  function toggleMobileSettingsMenu() {
    setSettingsMenuOpen((open) => !open)
  }

  useEffect(() => {
    if (!location.hash) return undefined

    const section = SETTINGS_SECTIONS.find(({ id }) => id === decodeURIComponent(location.hash.slice(1)))
    if (!section) return undefined

    let settleTimer: number | null = null
    const frameId = window.requestAnimationFrame(() => {
      const element = document.getElementById(section.id)
      if (!element) return

      skipScrollSpyRef.current = true
      setActiveSection(section.id)
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      settleTimer = window.setTimeout(() => {
        skipScrollSpyRef.current = false
      }, PROGRAMMATIC_SCROLL_SETTLE_MS)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      if (settleTimer !== null) window.clearTimeout(settleTimer)
    }
  }, [location.hash])

  useEffect(() => {
    let frameId: number | null = null

    /**
     * Updates the active nav item from the current scroll position and compact menu height
     */
    function syncActiveSection() {
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
          const element = document.getElementById(section.id)
          if (!element) continue
          if (element.getBoundingClientRect().top > activationLine) break
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
    if (!settingsMenuOpen) return undefined

    /**
     * Closes the compact menu when pointer focus moves outside the menu shell
     */
    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (mobileSettingsMenuRef.current?.contains(target)) return
      setSettingsMenuOpen(false)
    }

    /**
     * Gives keyboard users an explicit escape path from the compact menu
     */
    function handleKeyDown(event: KeyboardEvent) {
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
    if (!sentinel) return undefined

    const observer = new IntersectionObserver(
      ([entry]) => setSettingsMenuStuck(!entry.isIntersecting),
      { threshold: 0 },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  return {
    activeSection,
    activeSettingsSection: SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0],
    settingsMenuOpen,
    settingsMenuStuck,
    mobileSettingsStickySentinelRef,
    mobileSettingsMenuRef,
    navigateToSection,
    navigateFromMobileMenu,
    navigateToImport,
    toggleMobileSettingsMenu,
  }
}
