import { useRef, type KeyboardEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { IMPORT_CATEGORY_KIND_OPTIONS } from '@/pages/imports/constants'
import type { ImportCategoryKind } from '@/pages/imports/types'
import { getSegmentedControlKeyAction } from '@/pages/imports/utils'

/**
 * Segmented control for picking the kind of a category being created during import, with an
 * animated highlight that slides to the selected option
 *
 * It is a set of radio buttons rather than a tab list: nothing here reveals a panel, and the arrow
 * keys move between the options with one stop for the whole set in the tab order
 */
export function ImportCategoryTypeToggle({
  value,
  onChange,
  disabled,
}: {
  value: ImportCategoryKind | ''
  onChange: (value: ImportCategoryKind) => void
  disabled?: boolean
}) {
  const shouldReduceMotion = useReducedMotion()
  const selectedIndex = IMPORT_CATEGORY_KIND_OPTIONS.findIndex((option) => option.value === value)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Nothing is checked until the user answers, and a set with no checked option puts its first
  // option in the tab order so the control can still be reached
  const tabStopIndex = selectedIndex >= 0 ? selectedIndex : 0

  /**
   * Moves the selection with the arrow, Home and End keys, carrying focus with it
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return

    const action = getSegmentedControlKeyAction(event.key, selectedIndex, IMPORT_CATEGORY_KIND_OPTIONS.length)
    if (action.kind === 'none') return

    // Held back so an arrow inside the control does not also scroll the page behind it
    event.preventDefault()
    onChange(IMPORT_CATEGORY_KIND_OPTIONS[action.index].value)
    optionRefs.current[action.index]?.focus()
  }

  return (
    <div
      className={`app-segmented-control relative w-full overflow-hidden ${disabled ? 'opacity-60' : ''}`}
      role="radiogroup"
      aria-label="Category type"
      onKeyDown={handleKeyDown}
    >
      {selectedIndex >= 0 && (
        <motion.span
          className="pointer-events-none absolute rounded-md"
          style={{
            top: '0.125rem',
            bottom: '0.125rem',
            left: '0.125rem',
            width: `calc((100% - 0.25rem) / ${IMPORT_CATEGORY_KIND_OPTIONS.length})`,
            background: 'var(--app-accent-soft)',
            border: '1px solid var(--app-accent-border)',
          }}
          animate={{ x: `${selectedIndex * 100}%` }}
          transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 38 }}
          aria-hidden
        />
      )}
      {IMPORT_CATEGORY_KIND_OPTIONS.map((option, index) => {
        const active = value === option.value

        return (
          <button
            key={option.value}
            ref={(element) => { optionRefs.current[index] = element }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={index === tabStopIndex ? 0 : -1}
            className={`app-segmented-option relative z-10 w-1/3 px-0 text-center text-sm ${active ? 'app-segmented-option-active' : ''}`}
            style={active ? { background: 'transparent' } : undefined}
            onClick={() => onChange(option.value)}
            disabled={disabled}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
