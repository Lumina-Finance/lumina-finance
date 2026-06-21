import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CalendarRange, Check, ChevronDown } from 'lucide-react'
import { joinClassNames } from '@/utils/classNames'

export type TimeRangeSelectorOption<T extends string> = {
  value: T
  label: string
  description?: string
}

type TimeRangeSelectorProps<T extends string> = {
  value: T
  options: readonly TimeRangeSelectorOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
  variant?: 'desktop' | 'mobile'
  className?: string
  sheetTitle?: string
  dropdownPlacement?: 'bottom' | 'top'
  shortcutMode?: 'always' | 'when-description-differs'
}

const selectorSpring = { type: 'spring', stiffness: 420, damping: 36, mass: 0.8 } as const
const mobileDropdownTransition = { duration: 0.16, ease: [0.22, 1, 0.36, 1] } as const

/**
 * Resolves whether the compact shortcut label adds information beyond the main label
 */
function getRangeShortcut<T extends string>(
  option: TimeRangeSelectorOption<T>,
  shortcutMode: TimeRangeSelectorProps<T>['shortcutMode'],
) {
  if (shortcutMode === 'when-description-differs' && option.description === undefined) return null
  if (shortcutMode === 'when-description-differs' && option.description === option.label) return null
  return option.label
}

/**
 * Renders a desktop segmented range selector or mobile dropdown selector
 */
export function TimeRangeSelector<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  variant = 'desktop',
  className,
  sheetTitle,
  dropdownPlacement = 'bottom',
  shortcutMode = 'always',
}: TimeRangeSelectorProps<T>) {
  if (variant === 'mobile') {
    return (
      <MobileTimeRangeSelector
        value={value}
        options={options}
        onChange={onChange}
        ariaLabel={ariaLabel}
        className={className}
        sheetTitle={sheetTitle}
        dropdownPlacement={dropdownPlacement}
        shortcutMode={shortcutMode}
      />
    )
  }

  return (
    <DesktopTimeRangeSelector
      value={value}
      options={options}
      onChange={onChange}
      ariaLabel={ariaLabel}
      className={className}
    />
  )
}

/**
 * Renders the compact segmented desktop range control
 */
function DesktopTimeRangeSelector<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: TimeRangeSelectorProps<T>) {
  const shouldReduceMotion = useReducedMotion()
  const activeIndex = Math.max(options.findIndex((option) => option.value === value), 0)

  return (
    <div
      className={joinClassNames('app-segmented-control app-segmented-control-compact app-time-selector', className)}
      role="tablist"
      aria-label={ariaLabel}
    >
      <motion.span
        className="app-time-selector-indicator"
        aria-hidden
        style={{ width: `calc((100% - 0.25rem) / ${options.length})` }}
        animate={{ x: `${activeIndex * 100}%` }}
        transition={shouldReduceMotion ? { duration: 0 } : selectorSpring}
      />
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={joinClassNames(
              'app-segmented-option app-segmented-option-compact',
              active && 'app-segmented-option-active',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Renders the mobile range dropdown with optional top placement for floating controls
 */
function MobileTimeRangeSelector<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  sheetTitle,
  dropdownPlacement = 'bottom',
  shortcutMode = 'always',
}: TimeRangeSelectorProps<T>) {
  const [open, setOpen] = useState(false)
  const listboxId = useId()
  const selectorRef = useRef<HTMLDivElement>(null)
  const shouldReduceMotion = useReducedMotion()
  const selected = options.find((option) => option.value === value) ?? options[0]
  const selectedDisplay = selected.description ?? selected.label
  const selectedShortcut = getRangeShortcut(selected, shortcutMode)
  const dropdownPositionClass = dropdownPlacement === 'top'
    ? 'bottom-full mb-2'
    : 'top-full mt-2'
  const dropdownOrigin = dropdownPlacement === 'top' ? 'bottom center' : 'top center'
  const closedOffset = dropdownPlacement === 'top' ? 4 : -4
  const exitOffset = dropdownPlacement === 'top' ? 3 : -3

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (selectorRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    const timeoutId = window.setTimeout(() => window.addEventListener('pointerdown', onPointerDown), 0)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timeoutId)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const handleSelect = (nextValue: T) => {
    if (nextValue !== value) onChange(nextValue)
    setOpen(false)
  }

  return (
    <div ref={selectorRef} className={joinClassNames('relative', open && 'z-30', className)}>
      <button
        type="button"
        className="app-secondary-button h-9 w-full justify-between gap-3 px-3 text-sm"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={`${ariaLabel}: ${selectedDisplay}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <CalendarRange size={14} aria-hidden />
          <span className="truncate">{selectedDisplay}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
          {selectedShortcut && <span>{selectedShortcut}</span>}
          <ChevronDown
            size={13}
            aria-hidden
            className={joinClassNames('transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-180')}
          />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={listboxId}
            role="listbox"
            aria-label={sheetTitle ?? ariaLabel}
            className={`app-modal-panel absolute left-0 right-0 overflow-hidden rounded-xl ${dropdownPositionClass}`}
            initial={shouldReduceMotion ? false : { opacity: 0, y: closedOffset, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: exitOffset, scale: 0.99 }}
            transition={shouldReduceMotion ? { duration: 0 } : mobileDropdownTransition}
            style={{ transformOrigin: dropdownOrigin, willChange: 'transform, opacity' }}
          >
            <div>
              {options.map((option) => {
                const active = option.value === value
                const optionDisplay = option.description ?? option.label
                const optionShortcut = getRangeShortcut(option, shortcutMode)

                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-[var(--app-surface-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-soft)] motion-reduce:transition-none"
                    style={{
                      background: active ? 'var(--app-accent-soft)' : 'transparent',
                      color: active ? 'var(--app-accent)' : 'var(--app-text)',
                    }}
                    onClick={() => handleSelect(option.value)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{optionDisplay}</span>
                      {optionShortcut && (
                        <span className="mt-0.5 block text-xs font-medium uppercase" style={{ color: active ? 'var(--app-accent)' : 'var(--app-text-muted)' }}>
                          {optionShortcut}
                        </span>
                      )}
                    </span>
                    {active ? <Check size={16} className="shrink-0" aria-hidden /> : null}
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
