import { useContext } from 'react'
import { ToastContext, type ToastValue } from '@/contexts/ToastContext'

/**
 * Exposes the bottom-right message surface
 */
export function useToast(): ToastValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within a ToastProvider')
  return context
}
