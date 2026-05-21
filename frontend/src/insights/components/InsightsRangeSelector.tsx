import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CalendarRange, Check, ChevronDown } from 'lucide-react'

export type InsightsRangeSelectorOption<T extends string> = {
  value: T
  label: string
  description?: string
}

type InsightsRangeSelectorProps<T extends string> = {
  value: T
  options: readonly InsightsRangeSelectorOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
  sheetTitle?: string
  dropdownPlacement?: 'bottom' | 'top'
}

const dropdownTransition = { duration: 0.16, ease: [0.22, 1, 0.36, 1] } as const

function joinClassNames(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(' ')
}

export function InsightsRangeSelector<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  sheetTitle,
  dropdownPlacement = 'bottom',
}: InsightsRangeSelectorProps<T>) {
  const [open, setOpen] = useState(false)
  const listboxId = useId()
  const selectorRef = useRef<HTMLDivElement>(null)
  const shouldReduceMotion = useReducedMotion()
  const selected = options.find((option) => option.value === value) ?? options[0]
  const selectedDisplay = selected.description ?? selected.label
  const selectedShortcut = selected.description && selected.description !== selected.label ? selected.label : null
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
            transition={shouldReduceMotion ? { duration: 0 } : dropdownTransition}
            style={{ transformOrigin: dropdownOrigin, willChange: 'transform, opacity' }}
          >
            <div className="py-1">
              {options.map((option) => {
                const active = option.value === value
                const optionDisplay = option.description ?? option.label
                const optionShortcut = option.description && option.description !== option.label ? option.label : null

                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={joinClassNames(
                      'group flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-soft)] motion-reduce:transition-none',
                      active
                        ? 'bg-[var(--app-accent-soft)] text-[var(--app-accent)] hover:bg-[var(--app-accent-soft)]'
                        : 'text-[var(--app-text)] hover:bg-[var(--app-surface-soft)] hover:text-[var(--app-accent)]',
                    )}
                    onClick={() => handleSelect(option.value)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{optionDisplay}</span>
                      {optionShortcut && (
                        <span
                          className={joinClassNames(
                            'mt-0.5 block text-xs font-medium uppercase transition-colors duration-150 motion-reduce:transition-none',
                            active ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-muted)] group-hover:text-[var(--app-accent)]',
                          )}
                        >
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
