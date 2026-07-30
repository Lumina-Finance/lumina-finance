import { AnimatePresence, motion } from 'motion/react'
import { createPortal } from 'react-dom'
import { CircleCheck, TriangleAlert, X } from 'lucide-react'

export type ToastStatus = 'error' | 'success'

export interface ToastMessage {
  status: ToastStatus
  text: string
}

interface ToastProps {
  toast: ToastMessage | null
  onDismiss: () => void
}

const statusColor: Record<ToastStatus, string> = {
  error: 'var(--app-negative)',
  success: 'var(--app-positive)',
}

/**
 * Shows a short message in the bottom-right corner until it is dismissed
 *
 * An error is announced assertively, since it reports that something the user just asked for did not
 * happen and waiting for a pause in the screen reader's queue would lose that. The dismiss control is a
 * button inside the region rather than the region itself, so the message is what gets read out rather
 * than the name of the control
 */
export default function Toast({ toast, onDismiss }: ToastProps) {
  return (
    createPortal(
      <AnimatePresence>
        {toast && (
          <motion.div
            role={toast.status === 'error' ? 'alert' : 'status'}
            aria-live={toast.status === 'error' ? 'assertive' : 'polite'}
            className="fixed bottom-5 right-5 z-[110] flex max-w-[min(24rem,calc(100vw-2.5rem))] items-start gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium shadow-lg"
            style={{
              background: 'var(--app-bg)',
              border: '1px solid var(--app-border-strong)',
              color: 'var(--app-text)',
            }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.16 }}
          >
            <span
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
              style={{ background: statusColor[toast.status], color: 'var(--app-bg)' }}
            >
              {toast.status === 'error'
                ? <TriangleAlert size={14} strokeWidth={3} aria-hidden />
                : <CircleCheck size={14} strokeWidth={3} aria-hidden />}
            </span>
            <span className="leading-6">{toast.text}</span>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss message"
              className="app-icon-button -mr-1 -mt-1 h-6 w-6 shrink-0"
            >
              <X size={14} aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body,
    )
  )
}
