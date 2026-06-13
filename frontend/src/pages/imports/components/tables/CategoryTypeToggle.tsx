import { motion, useReducedMotion } from 'motion/react'
import { IMPORT_CATEGORY_KIND_OPTIONS } from '../../constants'
import type { ImportCategoryKind } from '../../types'

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

  return (
    <div
      className={`app-segmented-control relative w-full overflow-hidden ${disabled ? 'opacity-60' : ''}`}
      role="tablist"
      aria-label="Category type"
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
      {IMPORT_CATEGORY_KIND_OPTIONS.map((option) => {
        const active = value === option.value

        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
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
