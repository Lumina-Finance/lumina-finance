import { useId, type KeyboardEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { SEGMENTED_OPTION_GAP_REM, SELECTOR_SPRING } from '@/components/transactions/transaction-modal/constants'
import { joinClassNames } from '@/utils/classNames'

interface TransactionModalPillSelectorProps<T extends string> {
  id?: string

  // An empty value renders the unselected state with no highlighted option
  value: T | ''
  options: readonly { value: T; label: string }[]
  ariaLabel: string
  onChange: (value: T) => void
  disabled?: boolean
  /** Uses compact mobile spacing while keeping every option label on one line */
  compactOnMobile?: boolean

  /** The shortcut that jumps here, as `aria-keyshortcuts` writes it */
  keyShortcuts?: string
}

/**
 * Moves the choice one option along on an arrow key, as a group of tabs does, and puts focus on the
 * option it lands on. It stops at the ends
 */
function moveChoiceOnArrowKey<T extends string>(
  event: KeyboardEvent<HTMLDivElement>,
  options: readonly { value: T; label: string }[],
  onChange: (value: T) => void,
) {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (step === 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
  const current = buttons.findIndex((button) => button === document.activeElement)
  const next = buttons[current + step]
  if (current < 0 || !next) return

  event.preventDefault()
  onChange(options[buttons.indexOf(next)].value)
  next.focus()
}

/**
 * Renders the animated segmented selector used by transaction kind and direction controls
 */
export default function TransactionModalPillSelector<T extends string>({
  id,
  value,
  options,
  ariaLabel,
  onChange,
  disabled = false,
  compactOnMobile = false,
  keyShortcuts,
}: TransactionModalPillSelectorProps<T>) {
  const shouldReduceMotion = useReducedMotion()
  const indicatorId = useId()
  const optionGap = options.length > 1 ? SEGMENTED_OPTION_GAP_REM : 0

  return (
    <div
      id={id}
      className={joinClassNames(
        'app-segmented-control app-create-transaction-pill-selector relative isolate w-full overflow-hidden',
        disabled && 'cursor-not-allowed',
      )}
      role="tablist"
      aria-label={ariaLabel}
      aria-keyshortcuts={keyShortcuts}
      onKeyDown={(event) => moveChoiceOnArrowKey(event, options, onChange)}
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
              'app-segmented-option relative flex-1 text-sm',
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
