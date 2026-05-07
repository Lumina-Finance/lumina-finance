import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CalendarRange, Check, ChevronDown } from 'lucide-react'

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
}

const selectorSpring = { type: 'spring', stiffness: 420, damping: 36, mass: 0.8 } as const
const mobileDropdownTransition = { duration: 0.16, ease: [0.22, 1, 0.36, 1] } as const

function joinClassNames(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(' ')
}

export function TimeRangeSelector<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  variant = 'desktop',
  className,
  sheetTitle,
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

function MobileTimeRangeSelector<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  sheetTitle,
}: TimeRangeSelectorProps<T>) {
  const [open, setOpen] = useState(false)
  const listboxId = useId()
  const selectorRef = useRef<HTMLDivElement>(null)
  const shouldReduceMotion = useReducedMotion()
  const selected = options.find((option) => option.value === value) ?? options[0]

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
        aria-label={`${ariaLabel}: ${selected.description ?? selected.label}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <CalendarRange size={14} aria-hidden />
          <span className="truncate">{selected.description ?? selected.label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
          {selected.label}
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
            className="app-modal-panel absolute left-0 right-0 top-full mt-2 overflow-hidden rounded-xl"
            initial={shouldReduceMotion ? false : { opacity: 0, y: -4, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.99 }}
            transition={shouldReduceMotion ? { duration: 0 } : mobileDropdownTransition}
            style={{ transformOrigin: 'top center', willChange: 'transform, opacity' }}
          >
            <div className="py-1">
              {options.map((option) => {
                const active = option.value === value
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
                      <span className="block truncate text-sm font-semibold">{option.description ?? option.label}</span>
                      <span className="mt-0.5 block text-xs font-medium uppercase" style={{ color: active ? 'var(--app-accent)' : 'var(--app-text-muted)' }}>
                        {option.label}
                      </span>
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
