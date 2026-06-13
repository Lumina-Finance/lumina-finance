import { useEffect, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Landmark, X } from 'lucide-react'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { CREATE_ACCOUNT_EASE } from '@/pages/accounts/components/create-account-modal/constants'

interface CreateAccountModalShellProps {
  children: ReactNode
  isSubmitting: boolean
  open: boolean
  selectedAccountTypeLabel: string | undefined
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

/**
 * Renders the account creation modal chrome, browser effects, and footer actions
 */
export default function CreateAccountModalShell({
  children,
  isSubmitting,
  open,
  selectedAccountTypeLabel,
  onClose,
  onSubmit,
}: CreateAccountModalShellProps) {
  useBodyScrollLock(open)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

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
            transition={{ duration: 0.25, ease: CREATE_ACCOUNT_EASE }}
            onClick={onClose}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-account-title"
              className="app-modal-panel flex max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-2xl"
              style={{
                background: 'var(--app-bg)',
                border: '1px solid var(--app-border-strong)',
                boxShadow: 'var(--app-shadow-soft)',
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className="hidden w-16 shrink-0 flex-col items-center justify-between py-6 sm:flex"
                style={{
                  background: 'var(--app-button-primary-bg)',
                  color: 'var(--app-button-primary-text)',
                }}
                aria-hidden
              >
                <Landmark size={20} strokeWidth={2} />
                <span className="rotate-180 text-xs font-semibold uppercase" style={{ writingMode: 'vertical-rl' }}>
                  Account
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
                        className="mb-2 text-xs font-semibold uppercase"
                        style={{ color: 'var(--app-accent)' }}
                      >
                        {selectedAccountTypeLabel ?? 'New account'}
                      </p>
                      <h2
                        id="create-account-title"
                        className="font-serif text-3xl font-light"
                      >
                        Add Account
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

                <div
                  className="grid shrink-0 grid-cols-2 gap-3 px-6 py-4 sm:flex sm:justify-end sm:px-8 min-[1050px]:py-5"
                  style={{ borderTop: '1px solid var(--app-border)' }}
                >
                  <button
                    type="button"
                    className="app-secondary-button w-full sm:w-auto"
                    onClick={onClose}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${isSubmitting ? 'app-primary-button-loading justify-self-center sm:justify-self-auto' : 'w-full sm:w-40'}`}
                  >
                    {isSubmitting ? <div className="app-spinner" /> : 'Create Account'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}
