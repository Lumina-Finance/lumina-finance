import { motion, useReducedMotion } from 'motion/react'
import {
  TIME_SELECTOR_SPRING,
  type BalanceChartMode,
} from '@/accounts/detail/constants/accountDetail'

const BALANCE_CHART_MODE_OPTIONS: Array<{ value: BalanceChartMode; label: string }> = [
  { value: 'balance', label: 'Balance' },
  { value: 'change', label: 'Change' },
]

function joinClassNames(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(' ')
}

export function BalanceChartModeSelector({
  value,
  onChange,
  className,
}: {
  value: BalanceChartMode
  onChange: (value: BalanceChartMode) => void
  className?: string
}) {
  const shouldReduceMotion = useReducedMotion()
  const activeIndex = Math.max(
    BALANCE_CHART_MODE_OPTIONS.findIndex((option) => option.value === value),
    0,
  )

  return (
    <div
      className={joinClassNames(
        'app-segmented-control app-segmented-control-compact app-balance-chart-mode-selector min-w-0',
        className,
      )}
      role="tablist"
      aria-label="Balance chart view"
    >
      <motion.span
        className="pointer-events-none absolute rounded-md"
        aria-hidden
        style={{
          top: '0.125rem',
          bottom: '0.125rem',
          left: '0.125rem',
          width: `calc((100% - 0.25rem) / ${BALANCE_CHART_MODE_OPTIONS.length})`,
          background: 'var(--app-accent-soft)',
          border: '1px solid var(--app-accent-border)',
        }}
        animate={{ x: `${activeIndex * 100}%` }}
        transition={shouldReduceMotion ? { duration: 0 } : TIME_SELECTOR_SPRING}
      />
      {BALANCE_CHART_MODE_OPTIONS.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={joinClassNames(
              'app-segmented-option app-segmented-option-compact relative z-10 flex-1 px-3',
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
