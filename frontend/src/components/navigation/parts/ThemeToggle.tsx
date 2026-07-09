import { motion, useReducedMotion } from 'motion/react'
import type { Theme } from '@/types'
import { THEME_OPTIONS, THEME_TOGGLE_SPRING } from '@/components/navigation/constants/data'

interface NavigationThemeToggleProps {
  theme: Theme
  setTheme: (theme: Theme) => void
  onThemeChange?: () => void
}

/**
 * Renders the navigation theme segmented control and respects reduced-motion preferences
 */
export function NavigationThemeToggle({
  theme,
  setTheme,
  onThemeChange,
}: NavigationThemeToggleProps) {
  const shouldReduceMotion = useReducedMotion()
  const activeIndex = Math.max(THEME_OPTIONS.findIndex((option) => option.value === theme), 0)

  return (
    <div
      className="app-segmented-control app-navigation-theme-toggle relative isolate w-full overflow-hidden"
      role="group"
      aria-label="Theme selection"
    >
      <motion.span
        className="app-navigation-theme-toggle-indicator"
        aria-hidden
        initial={false}
        style={{ width: `calc((100% - 0.5rem) / ${THEME_OPTIONS.length})` }}
        animate={{ x: `${activeIndex * 100}%` }}
        transition={shouldReduceMotion ? { duration: 0 } : THEME_TOGGLE_SPRING}
      />
      {THEME_OPTIONS.map(({ value, icon: Icon, label }) => {
        const isActive = theme === value
        return (
          <button
            key={value}
            type="button"
            onClick={() => {
              if (value === theme) return
              setTheme(value)
              onThemeChange?.()
            }}
            aria-pressed={isActive}
            aria-label={label}
            className={`app-segmented-option relative z-10 px-0 ${isActive ? 'app-segmented-option-active' : ''}`}
          >
            <Icon size={16} strokeWidth={isActive ? 2.25 : 2} aria-hidden />
          </button>
        )
      })}
    </div>
  )
}
