import { useEffect } from 'react'

interface TransactionModalEnvironmentOptions {
  open: boolean
  onClose: () => void
}

/**
 * Applies browser-level modal behaviour while the transaction modal is open
 */
export function useTransactionModalEnvironment({
  open,
  onClose,
}: TransactionModalEnvironmentOptions) {
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, open])
}
