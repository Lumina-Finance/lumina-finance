import { useId } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { InsightCalculationTooltip } from '@/pages/insights/components/InsightCalculationTooltip'
import type { FundFlowEntry } from '@/pages/insights/types/fundFlow'
import { joinClassNames } from '@/utils/classNames'
import { formatCurrency } from '@/utils/formatCurrency'

type FundFlowCategoryListProps = {
  title: string
  normalEntries: FundFlowEntry[]
  flippedEntries: FundFlowEntry[]
  flippedLabel: string
  normalLabel: string
  calculation: string
  displayCurrency: string
  open: boolean
  onToggle: () => void
}

const listTransition = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const

/**
 * Renders one expandable fund-flow category list with flipped-entry labelling
 */
export function FundFlowCategoryList({
  title,
  normalEntries,
  flippedEntries,
  flippedLabel,
  normalLabel,
  calculation,
  displayCurrency,
  open,
  onToggle,
}: FundFlowCategoryListProps) {
  const listId = useId()
  const shouldReduceMotion = useReducedMotion()
  const totalCount = normalEntries.length + flippedEntries.length
  const displayCount = flippedEntries.length > 0
    ? `${normalEntries.length} + ${flippedEntries.length}`
    : String(totalCount)
  const rows = [
    ...flippedEntries.map((entry) => ({ entry, label: flippedLabel, flipped: true })),
    ...normalEntries.map((entry) => ({ entry, label: normalLabel, flipped: false })),
  ]

  return (
    <div
      className="w-full self-start overflow-visible rounded-xl border border-[var(--app-border)]"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="relative flex min-h-14 w-full items-center justify-between gap-4 px-3 py-2">
        <button
          type="button"
          className="absolute inset-0 rounded-xl text-left transition-colors duration-150 hover:bg-[var(--app-surface-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-soft)] motion-reduce:transition-none"
          aria-expanded={open}
          aria-controls={listId}
          onClick={onToggle}
        >
          <span className="sr-only">Toggle {title}</span>
        </button>
        <span className="pointer-events-none relative z-10 min-w-0">
          <span className="app-label inline-flex items-center gap-2">
            {title}
            <span className="pointer-events-auto">
              <InsightCalculationTooltip
                label={title}
                calculation={calculation}
              />
            </span>
          </span>
          <span className="mt-1 block font-financial text-xl leading-none">
            {displayCount}
          </span>
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={joinClassNames('pointer-events-none relative z-10 shrink-0 transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-180')}
          style={{ color: 'var(--app-accent)' }}
        />
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            id={listId}
            initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : listTransition}
            className="overflow-hidden border-t border-[var(--app-border)]"
          >
            <div className="h-56 overflow-y-auto">
              {rows.length > 0 ? rows.map(({ entry: [name, amount], label, flipped }) => (
                <div
                  key={`${label}-${name}-${amount}`}
                  className="flex h-14 items-center justify-between gap-4 px-3 text-sm transition-colors duration-150 hover:bg-[var(--app-surface-soft)] motion-reduce:transition-none"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{name}</span>
                    <span
                      className="mt-0.5 block text-xs font-medium"
                      style={{ color: flipped ? 'var(--app-accent)' : 'var(--app-text-muted)' }}
                    >
                      {label}
                    </span>
                  </span>
                  <span className="shrink-0 font-financial">
                    {formatCurrency(amount, displayCurrency)}
                  </span>
                </div>
              )) : (
                <div className="flex h-56 items-center px-3 text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  No categories in this range.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
