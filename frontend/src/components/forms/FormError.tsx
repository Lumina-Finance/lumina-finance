import { AnimatePresence, motion } from 'motion/react'
import { joinClassNames } from '@/utils/classNames'

interface FormErrorProps {
  /** Why the request failed, or nothing while it has not */
  message?: string | null
  /** Lets a field the failure is about point to the message as its description */
  id?: string
  className?: string
}

/**
 * The message a dialog shows when a request fails for a reason that belongs to no field, such as the
 * server being unreachable. Problems with a field's own input go through `FieldError` instead
 */
export function FormError({ message, id, className }: FormErrorProps) {
  return (
    <AnimatePresence>
      {message && (
        <motion.p
          key={message}
          id={id}
          role="alert"
          className={joinClassNames('text-sm font-medium', className)}
          style={{ color: 'var(--app-negative)' }}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  )
}
