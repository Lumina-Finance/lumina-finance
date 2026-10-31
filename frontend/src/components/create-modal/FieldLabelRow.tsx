import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FieldError } from '@/components/forms/FieldError'
import { joinClassNames } from '@/utils/classNames'
import { focusChosenOption, getFieldLabelId } from '@/utils/fieldLabel'

const ACTION_SLOT_EASE = [0.25, 0.1, 0.25, 1] as const

interface CreateModalFieldLabelRowProps {
  accessory?: ReactNode
  // Rendered opposite the label, replacing it with the error message while one is present. While it
  // shows, the row stacks on narrow layouts, since the label and the action need their own lines until
  // there is room to sit side by side. A message fits on the label's line, so the row stays one line
  // without the action, the same as a field that has none
  action?: ReactNode
  error?: string | false
  /** Id for the message, so the field it is about can point to it as its description */
  errorId?: string
  htmlFor?: string
  label: ReactNode

  // Id of a segmented control the label stands over in place of htmlFor, whose chosen option a click
  // on the label brings into focus
  optionGroupId?: string
}

/**
 * Displays a create-modal field label with an optional accessory, an optional action slot, and an
 * animated validation message
 */
export default function CreateModalFieldLabelRow({
  accessory,
  action,
  error,
  errorId,
  htmlFor,
  label,
  optionGroupId,
}: CreateModalFieldLabelRowProps) {
  const stacksOnNarrowLayouts = Boolean(action) && !error

  return (
    <div
      className={joinClassNames(
        'mb-1.5 flex items-start justify-between gap-3',
        stacksOnNarrowLayouts && 'flex-col gap-1.5 sm:flex-row sm:items-end sm:gap-3',
      )}
    >
      <div className="relative flex min-w-0 items-center gap-1.5">
        <label
          id={htmlFor && getFieldLabelId(htmlFor)}
          htmlFor={htmlFor}
          className="app-label block shrink-0 text-[0.9375rem] leading-5"
          onClick={optionGroupId ? () => focusChosenOption(optionGroupId) : undefined}
        >
          {label}
        </label>
        {accessory}
      </div>
      <FieldError message={error} id={errorId} />
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
