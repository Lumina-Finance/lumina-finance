import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Toast, { type ToastMessage } from '@/components/feedback/Toast'

// Long enough to read a sentence without the message becoming furniture
const TOAST_VISIBLE_MS = 6000

export interface ToastValue {
  /** Replaces whatever is showing, so the newest message is always the visible one */
  showToast: (toast: ToastMessage) => void
  dismissToast: () => void
}

const ToastContext = createContext<ToastValue | null>(null)

/**
 * Holds the one message showing in the bottom-right corner, so any page can raise one without owning
 * the markup or the dismissal timer
 *
 * Only one shows at a time. A second message replaces the first rather than stacking, since these
 * report the action the user just took and an older one is already answered
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const timeoutRef = useRef<number | undefined>(undefined)

  const clearTimer = useCallback(() => {
    if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = undefined
  }, [])

  useEffect(() => clearTimer, [clearTimer])

  const dismissToast = useCallback(() => {
    clearTimer()
    setToast(null)
  }, [clearTimer])

  const showToast = useCallback((next: ToastMessage) => {
    clearTimer()
    setToast(next)
    timeoutRef.current = window.setTimeout(() => setToast(null), TOAST_VISIBLE_MS)
  }, [clearTimer])

  const value = useMemo<ToastValue>(() => ({ showToast, dismissToast }), [dismissToast, showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast toast={toast} onDismiss={dismissToast} />
    </ToastContext.Provider>
  )
}

export { ToastContext }
