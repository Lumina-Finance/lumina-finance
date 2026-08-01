import { AnimatePresence, motion } from 'motion/react'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import {
  DIRECTION_OPTIONS,
  EASE,
  KIND_OPTIONS,
} from '@/pages/transactions/components/transaction-modal/constants'
import type {
  TransactionDirection,
  TransactionModalKind,
} from '@/pages/transactions/components/transaction-modal/types'
import TransactionModalPillSelector from '@/pages/transactions/components/transaction-modal/controls/PillSelector'

interface TransactionTypeDirectionSectionProps {
  kind: TransactionModalKind

  // An empty direction renders the unselected state, used when a symmetric transfer does not involve the viewed account
  direction: TransactionDirection | ''
  editing: boolean
  readOnly: boolean
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
  readOnly,
  directionHighlightKey,
  onKindChange,
  onDirectionChange,
}: TransactionTypeDirectionSectionProps) {
  return (
    <CreateModalSectionFrame step="01" title="Type & Direction">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <TransactionModalPillSelector
          value={kind}
          options={KIND_OPTIONS}
          ariaLabel="Transaction type"
          onChange={onKindChange}
          disabled={editing || readOnly}
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
            disabled={readOnly}
          />
        </div>
      </div>
    </CreateModalSectionFrame>
  )
}
