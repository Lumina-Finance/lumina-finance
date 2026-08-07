import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
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
  shortcutMode?: 'always' | 'when-description-differs'
}

const selectorSpring = { type: 'spring', stiffness: 420, damping: 36, mass: 0.8 } as const

// Matches the liquid-glass filter pill on the transaction toolbar so the mobile range dropdown reads
// as the same control family, a gently damped spring that settles with little overshoot
const glassSpring = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 } as const

// Added to the collapsed head height so the pinned layout slot also covers the glass border, keeping
// the blooming panel free to overlay the content below without nudging it
const GLASS_BORDER_ALLOWANCE = 2

// Lifts the glass over the content the open panel blooms across. Open, the wrapper takes z-30 and is
// a stacking context, so this resolves inside this control. Closed, the wrapper is only relative and
// what holds the 50 inside the page is the isolation on app-page-content, without which it would
// reach the top of the page and tie with the mobile navigation button, which is also 50
const GLASS_Z_INDEX = 50

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
 * Renders the mobile range control as a liquid-glass pill that blooms its option list open, sharing
 * the style and animation of the transaction toolbar filter. The panel overlays the content below
 * rather than pushing it, so the pinned layout slot holds the collapsed height while it is open
 */
function MobileTimeRangeSelector<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  sheetTitle,
  shortcutMode = 'always',
}: TimeRangeSelectorProps<T>) {
  const [open, setOpen] = useState(false)
  const [collapsedHeight, setCollapsedHeight] = useState<number>()
  const listboxId = useId()
  const selectorRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLButtonElement>(null)
  const shouldReduceMotion = useReducedMotion()
  const selected = options.find((option) => option.value === value) ?? options[0]
  const selectedDisplay = selected.description ?? selected.label
  const selectedShortcut = getRangeShortcut(selected, shortcutMode)
  const transition = shouldReduceMotion ? { duration: 0 } : glassSpring

  // Pin the layout slot to the collapsed pill height while closed, so opening lets the absolute glass
  // grow over the content below instead of shifting it. Remeasured when the label changes since that
  // can reflow the head height
  useLayoutEffect(() => {
    const head = headRef.current
    if (open || !head) return
    setCollapsedHeight(head.offsetHeight + GLASS_BORDER_ALLOWANCE)
  }, [open, selectedDisplay, selectedShortcut])

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
    <div
      ref={selectorRef}
      className={joinClassNames('relative', open && 'z-30', className)}
      style={{ height: collapsedHeight }}
    >
      <motion.div
        className={joinClassNames('app-range-glass app-range-glass-full', open && 'app-range-glass-open')}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: GLASS_Z_INDEX }}
        whileTap={open || shouldReduceMotion ? undefined : { scale: 0.94 }}
      >
        <button
          ref={headRef}
          type="button"
          className="app-range-glass-head"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-label={`${ariaLabel}: ${selectedDisplay}`}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="app-range-glass-cur">
            <CalendarRange size={18} aria-hidden className="shrink-0" />
            <span className="truncate">{selectedDisplay}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
            {selectedShortcut && <span>{selectedShortcut}</span>}
            <motion.span
              className="app-range-glass-chev"
              style={{ display: 'inline-flex' }}
              animate={{ rotate: open ? 180 : 0 }}
              transition={transition}
            >
              <ChevronDown size={16} aria-hidden />
            </motion.span>
          </span>
        </button>

        <div className="app-range-glass-bodywrap">
          <div className="app-range-glass-body">
            <div
              id={listboxId}
              role="listbox"
              aria-label={sheetTitle ?? ariaLabel}
              className="app-range-glass-inner"
              style={{ padding: '2px 6px 6px' }}
            >
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
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 hover:bg-[var(--app-surface-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-soft)] motion-reduce:transition-none"
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
          </div>
        </div>
      </motion.div>
    </div>
  )
}
