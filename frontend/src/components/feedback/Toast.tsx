import { AnimatePresence, motion } from 'motion/react'
import { CircleCheck, TriangleAlert } from 'lucide-react'

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
 * happen and waiting for a pause in the screen reader's queue would lose that
 */
export default function Toast({ toast, onDismiss }: ToastProps) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
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
        </motion.button>
      )}
    </AnimatePresence>
  )
}
