import { useId } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  SEGMENTED_OPTION_GAP_REM,
  SELECTOR_SPRING,
} from '@/pages/transactions/components/transaction-modal/constants'
import { joinClassNames } from '@/utils/classNames'

interface TransactionModalPillSelectorProps<T extends string> {
  // An empty value renders the unselected state with no highlighted option
  value: T | ''
  options: readonly { value: T; label: string }[]
  ariaLabel: string
  onChange: (value: T) => void
  disabled?: boolean
  /** Uses compact mobile spacing while keeping every option label on one line */
  compactOnMobile?: boolean
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
  compactOnMobile = false,
}: TransactionModalPillSelectorProps<T>) {
  const shouldReduceMotion = useReducedMotion()
  const indicatorId = useId()
  const optionGap = options.length > 1 ? SEGMENTED_OPTION_GAP_REM : 0

  return (
    <div
      className={joinClassNames('app-segmented-control app-create-transaction-pill-selector relative isolate w-full overflow-hidden', disabled && 'cursor-not-allowed')}
      role="tablist"
      aria-label={ariaLabel}
      style={{ gap: `${optionGap}rem` }}
    >
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
              'app-segmented-option relative flex-1 bg-transparent text-sm',
              compactOnMobile && 'whitespace-nowrap px-1 text-xs sm:px-2.5 sm:text-sm',
              active && 'app-segmented-option-active',
              disabled && 'cursor-not-allowed',
              disabled && !active && 'opacity-40',
            )}
          >
            {active && (
              <motion.span
                layoutId={indicatorId}
                className="app-create-transaction-pill-selector-indicator"
                aria-hidden
                transition={shouldReduceMotion ? { duration: 0 } : SELECTOR_SPRING}
              />
            )}
            <span className="relative z-10">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
