import { createContext } from 'react'
import type { ToastMessage } from '@/components/feedback/Toast'

export interface ToastValue {
  /** Replaces whatever is showing, so the newest message is always the visible one */
  showToast: (toast: ToastMessage) => void
  dismissToast: () => void
}

export const ToastContext = createContext<ToastValue | null>(null)
