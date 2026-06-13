import { motion, useReducedMotion } from 'motion/react'
import {
  SEGMENTED_OPTION_GAP_REM,
  SELECTOR_SPRING,
} from '@/transactions/components/transaction-modal/transactionModalConstants'
import { joinClassNames } from '@/utils/classNames'

interface TransactionModalPillSelectorProps<T extends string> {
  value: T
  options: readonly { value: T; label: string }[]
  ariaLabel: string
  onChange: (value: T) => void
  disabled?: boolean
}

/**
 * Renders the animated segmented selector used by transaction kind and direction controls
 */
export default function TransactionModalPillSelector<T extends string>({
  value,
  options,
  ariaLabel,
  onChange,
  disabled = false,
}: TransactionModalPillSelectorProps<T>) {
  const shouldReduceMotion = useReducedMotion()
  const activeIndex = Math.max(options.findIndex((option) => option.value === value), 0)
  const optionGap = options.length > 1 ? SEGMENTED_OPTION_GAP_REM : 0
  const indicatorWidth = `calc((100% - 0.5rem - ${(options.length - 1) * optionGap}rem) / ${options.length})`
  const indicatorX = `calc(${activeIndex * 100}% + ${activeIndex * optionGap}rem)`

  return (
    <div
      className={joinClassNames('app-segmented-control app-create-transaction-pill-selector relative isolate w-full overflow-hidden', disabled && 'cursor-not-allowed')}
      role="tablist"
      aria-label={ariaLabel}
      style={{ gap: `${optionGap}rem` }}
    >
      <motion.span
        className="app-create-transaction-pill-selector-indicator"
        aria-hidden
        style={{ width: indicatorWidth }}
        animate={{ x: indicatorX }}
        transition={shouldReduceMotion ? { duration: 0 } : SELECTOR_SPRING}
      />
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={joinClassNames(
              'app-segmented-option relative z-10 flex-1 bg-transparent text-sm',
              active && 'app-segmented-option-active',
              disabled && 'cursor-not-allowed',
              disabled && !active && 'opacity-40',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
