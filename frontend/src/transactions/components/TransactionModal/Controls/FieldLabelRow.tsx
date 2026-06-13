import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { EASE } from '@/transactions/components/TransactionModal/constants'
import { joinClassNames } from '@/utils/classNames'

interface TransactionModalFieldLabelRowProps {
  label: string
  htmlFor?: string
  error?: string | false
  action?: ReactNode
}

/**
 * Renders a transaction modal field label with animated error and action slots
 */
export default function TransactionModalFieldLabelRow({
  label,
  htmlFor,
  error,
  action,
}: TransactionModalFieldLabelRowProps) {
  const hasActionSlot = action !== undefined

  return (
    <div className={joinClassNames('mb-1.5 flex items-start justify-between gap-3', hasActionSlot && 'flex-col gap-1.5 sm:flex-row sm:items-end sm:gap-3')}>
      <label htmlFor={htmlFor} className="app-label block shrink-0 text-[0.9375rem] leading-5">{label}</label>
      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            key={error}
            className="text-right text-xs font-medium leading-5"
            style={{ color: 'var(--app-negative)' }}
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            transition={{ duration: 0.15 }}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {!error && action && (
          <motion.div
            key="field-action"
            className="min-w-0 max-w-full overflow-hidden sm:ml-auto"
            initial={{ height: 0, opacity: 0, y: 4 }}
            animate={{ height: 'auto', opacity: 1, y: 0 }}
            exit={{ height: 0, opacity: 0, y: 4 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            {action}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
