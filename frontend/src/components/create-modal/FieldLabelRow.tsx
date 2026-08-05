import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { joinClassNames } from '@/utils/classNames'
import { getFieldLabelId } from '@/utils/fieldLabel'

const ACTION_SLOT_EASE = [0.25, 0.1, 0.25, 1] as const

interface CreateModalFieldLabelRowProps {
  accessory?: ReactNode
  // Rendered opposite the label, replacing it with the error message while one is present. A caller
  // that supplies this stacks the row on narrow layouts, since the label and the action need their own
  // lines until there is room to sit side by side
  action?: ReactNode
  error?: string | false
  htmlFor?: string
  label: ReactNode
}

/**
 * Displays a create-modal field label with an optional accessory, an optional action slot, and an
 * animated validation message
 */
export default function CreateModalFieldLabelRow({
  accessory,
  action,
  error,
  htmlFor,
  label,
}: CreateModalFieldLabelRowProps) {
  const hasActionSlot = action !== undefined

  return (
    <div
      className={joinClassNames(
        'mb-1.5 flex items-start justify-between gap-3',
        hasActionSlot && 'flex-col gap-1.5 sm:flex-row sm:items-end sm:gap-3',
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <label
          id={htmlFor && getFieldLabelId(htmlFor)}
          htmlFor={htmlFor}
          className="app-label block shrink-0 text-[0.9375rem] leading-5"
        >
          {label}
        </label>
        {accessory}
      </div>
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
            transition={{ duration: 0.18, ease: ACTION_SLOT_EASE }}
          >
            {action}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
