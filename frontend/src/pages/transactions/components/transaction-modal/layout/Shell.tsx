import { useEffect, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ReceiptText, X } from 'lucide-react'
import { EASE } from '@/pages/transactions/components/transaction-modal/constants'
import {
  getNextTransactionModalFieldTabStop,
  getTransactionModalFieldTabStops,
} from '@/pages/transactions/components/transaction-modal/utils/focus'

interface TransactionModalShellProps {
  open: boolean
  editing: boolean
  transactionKindLabel: string
  headerStatus?: string
  children: ReactNode
  footer: ReactNode
  onClose: () => void
  onSubmit: (event: FormEvent) => void
}

/**
 * Renders the transaction modal portal, panel, header, form, and footer slots
 */
export default function TransactionModalShell({
  open,
  editing,
  transactionKindLabel,
  headerStatus,
  children,
  footer,
  onClose,
  onSubmit,
}: TransactionModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const frameId = window.requestAnimationFrame(() => {
      const firstField = panelRef.current
        ? getTransactionModalFieldTabStops(panelRef.current)[0]
        : undefined

      firstField?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [open])

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return

    const panel = panelRef.current
    if (!panel) return

    const fieldTabStops = getTransactionModalFieldTabStops(panel)
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const nextField = getNextTransactionModalFieldTabStop(fieldTabStops, activeElement, event.shiftKey)

    if (!nextField) {
      event.preventDefault()
      return
    }

    event.preventDefault()
    nextField.focus()
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50"
            style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden
          />

          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.25, ease: EASE }}
            onClick={onClose}
          >
            <motion.div
              ref={panelRef}
              layout
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-txn-title"
              className="app-modal-panel flex max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-2xl"
              transition={{ layout: { duration: 0.22, ease: EASE } }}
              style={{
                background: 'var(--app-bg)',
                border: '1px solid var(--app-border-strong)',
                boxShadow: 'var(--app-shadow-soft)',
              }}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={handleTabKeyDown}
            >
              <div
                className="hidden w-16 shrink-0 flex-col items-center justify-between py-6 sm:flex"
                style={{
                  background: 'var(--app-button-primary-bg)',
                  color: 'var(--app-button-primary-text)',
                }}
                aria-hidden
              >
                <ReceiptText size={20} strokeWidth={2} />
                <span className="rotate-180 text-xs font-semibold uppercase" style={{ writingMode: 'vertical-rl' }}>
                  Transaction
                </span>
              </div>

              <form onSubmit={onSubmit} className="flex min-h-0 w-full flex-col" noValidate>
                <div
                  className="shrink-0 pb-5 pl-4 pr-5 pt-6 sm:pt-7 min-[1050px]:px-8"
                  style={{ borderBottom: '1px solid var(--app-border)' }}
                >
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <p
                        className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold uppercase"
                        style={{ color: 'var(--app-accent)' }}
                      >
                        <span>{editing ? 'Existing transaction' : `${transactionKindLabel} transaction`}</span>
                        {headerStatus && (
                          <>
                            <span aria-hidden style={{ color: 'var(--app-text-subtle)' }}>
                              &middot;
                            </span>
                            <span style={{ color: 'var(--app-warning-text)' }}>
                              {headerStatus}
                            </span>
                          </>
                        )}
                      </p>
                      <h2
                        id="create-txn-title"
                        className="font-serif text-3xl font-light"
                      >
                        {editing ? 'Edit Transaction' : 'Add Transaction'}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={onClose}
                      className="app-icon-button shrink-0"
                      aria-label="Close"
                    >
                      <X size={20} aria-hidden />
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto pb-3 pl-4 pr-5 pt-4 min-[1050px]:px-8">
                  {children}
                </div>

                {footer}
              </form>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}
