import { AnimatePresence, motion } from 'motion/react'
import {
  DIRECTION_OPTIONS,
  EASE,
  KIND_OPTIONS,
} from '@/transactions/components/TransactionModal/transactionModalConstants'
import type {
  TransactionDirection,
  TransactionModalKind,
} from '@/transactions/components/TransactionModal/transactionModalTypes'
import TransactionModalPillSelector from '@/transactions/components/TransactionModal/TransactionModalPillSelector'
import TransactionModalSectionFrame from '@/transactions/components/TransactionModal/TransactionModalSectionFrame'

interface TransactionTypeDirectionSectionProps {
  kind: TransactionModalKind
  direction: TransactionDirection
  editing: boolean
  directionHighlightKey: number
  onKindChange: (kind: TransactionModalKind) => void
  onDirectionChange: (direction: TransactionDirection) => void
}

/**
 * Renders the transaction kind and direction controls at the top of the modal form
 */
export default function TransactionTypeDirectionSection({
  kind,
  direction,
  editing,
  directionHighlightKey,
  onKindChange,
  onDirectionChange,
}: TransactionTypeDirectionSectionProps) {
  return (
    <TransactionModalSectionFrame number="01" title="Type & Direction">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <TransactionModalPillSelector
          value={kind}
          options={KIND_OPTIONS}
          ariaLabel="Transaction type"
          onChange={onKindChange}
          disabled={editing}
        />
        <div className="relative rounded-lg">
          <AnimatePresence initial={false}>
            {directionHighlightKey > 0 && (
              <motion.span
                key={directionHighlightKey}
                className="pointer-events-none absolute inset-0 rounded-lg"
                initial={{ boxShadow: '0 0 0 0 var(--app-accent-soft)' }}
                animate={{ boxShadow: ['0 0 0 0 var(--app-accent-soft)', '0 0 0 3px var(--app-accent-soft)', '0 0 0 0 var(--app-accent-soft)'] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.45, ease: EASE }}
                aria-hidden
              />
            )}
          </AnimatePresence>
          <TransactionModalPillSelector
            value={direction}
            options={DIRECTION_OPTIONS}
            ariaLabel="Transaction direction"
            onChange={onDirectionChange}
          />
        </div>
      </div>
    </TransactionModalSectionFrame>
  )
}
