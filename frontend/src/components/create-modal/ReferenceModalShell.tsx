import { useEffect, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { X, type LucideIcon } from 'lucide-react'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { useModalFieldFocus } from '@/components/modal/useModalFieldFocus'

export type CreateReferenceModalVariant = 'primary' | 'secondary'

interface CreateReferenceModalShellProps {
  children: ReactNode
  closeDisabled?: boolean
  eyebrow: string
  footerError?: string | null
  modalTitleId: string
  open: boolean
  railLabel?: string
  RailIcon?: LucideIcon
  submitDisabled: boolean
  submitLabel: string
  submitWidthClassName: string
  title: string
  variant?: CreateReferenceModalVariant
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

const EASE = [0.25, 0.1, 0.25, 1] as const

const layoutByVariant = {
  primary: {
    backdropClassName: 'fixed inset-0 z-50',
    backdropStyle: { background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' },
    backdropTransition: 0.2,
    bodyClassName: 'min-h-0 flex-1 overflow-y-auto pb-3 pl-4 pr-5 pt-4 min-[1050px]:px-8',
    footerClassName: 'grid shrink-0 grid-cols-2 gap-3 px-6 py-4 sm:flex sm:justify-end sm:px-8 min-[1050px]:py-5',
    headerClassName: 'shrink-0 pb-5 pl-4 pr-5 pt-6 sm:pt-7 min-[1050px]:px-8',
    iconSize: 20,
    modalClassName: 'app-modal-panel flex max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-2xl',
    panelClassName: 'fixed inset-0 z-[60] flex items-center justify-center p-4',
    panelInitial: { opacity: 0, scale: 0.96, y: 12 },
    panelTransition: { duration: 0.25, ease: EASE },
    railClassName: 'hidden w-16 shrink-0 flex-col items-center justify-between py-6 sm:flex',
    railLabelClassName: 'text-xs',
    railStyle: {
      background: 'var(--app-button-primary-bg)',
      color: 'var(--app-button-primary-text)',
    },
  },
  secondary: {
    backdropClassName: 'fixed inset-0 z-[100]',
    backdropStyle: { background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(10px)' },
    backdropTransition: 0.15,
    bodyClassName: 'min-h-0 flex-1 overflow-y-auto pb-3 pl-4 pr-5 pt-4 min-[1050px]:px-7',
    footerClassName: 'grid shrink-0 grid-cols-2 gap-3 px-6 py-4 sm:flex sm:justify-end sm:px-7 min-[1050px]:py-5',
    headerClassName: 'shrink-0 pb-5 pl-4 pr-5 pt-6 min-[1050px]:px-7',
    iconSize: 18,
    modalClassName: 'app-modal-panel flex max-h-[84vh] w-full max-w-xl overflow-hidden rounded-2xl',
    panelClassName: 'fixed inset-0 z-[100] flex items-center justify-center p-4',
    panelInitial: { opacity: 0, scale: 0.94, y: 16 },
    panelTransition: { duration: 0.22, ease: EASE },
    railClassName: 'app-secondary-modal-rail hidden w-12 shrink-0 flex-col items-center justify-between py-5 sm:flex',
    railLabelClassName: 'text-[0.6875rem]',
    railStyle: {
      background: 'var(--app-surface-soft)',
      borderRight: '1px solid var(--app-border)',
      color: 'var(--app-accent)',
    },
  },
} as const

/**
 * Renders the shared portal, chrome, close behaviour, and footer for reference-data creation modals
 */
export default function CreateReferenceModalShell({
  children,
  closeDisabled = false,
  eyebrow,
  footerError,
  modalTitleId,
  open,
  railLabel,
  RailIcon,
  submitDisabled,
  submitLabel,
  submitWidthClassName,
  title,
  variant = 'primary',
  onClose,
  onSubmit,
}: CreateReferenceModalShellProps) {
  const layout = layoutByVariant[variant]
  const closeIfAllowed = closeDisabled ? undefined : onClose
  const hasRail = RailIcon && railLabel
  const { panelRef, handleModalFieldKeyDown } = useModalFieldFocus(open)

  useBodyScrollLock(open && variant !== 'secondary')

  useEffect(() => {
    if (!open || closeDisabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeDisabled, onClose, open])

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className={layout.backdropClassName}
            style={layout.backdropStyle}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: layout.backdropTransition }}
            onClick={closeIfAllowed}
            aria-hidden
          />

          <motion.div
            className={layout.panelClassName}
            initial={layout.panelInitial}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={layout.panelInitial}
            transition={layout.panelTransition}
            onClick={closeIfAllowed}
          >
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={modalTitleId}
              className={layout.modalClassName}
              style={{
                background: 'var(--app-bg)',
                border: '1px solid var(--app-border-strong)',
                boxShadow: 'var(--app-shadow-soft)',
              }}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={handleModalFieldKeyDown}
            >
              {hasRail && (
                <div className={layout.railClassName} style={layout.railStyle} aria-hidden>
                  <RailIcon size={layout.iconSize} strokeWidth={2} />
                  <span className={`${layout.railLabelClassName} rotate-180 font-semibold uppercase`} style={{ writingMode: 'vertical-rl' }}>
                    {railLabel}
                  </span>
                </div>
              )}

              <form onSubmit={onSubmit} className="flex min-h-0 w-full flex-col" noValidate>
                <div className={layout.headerClassName} style={{ borderBottom: '1px solid var(--app-border)' }}>
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                        {eyebrow}
                      </p>
                      <h3 id={modalTitleId} className="font-serif text-3xl font-light">
                        {title}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={onClose}
                      className="app-icon-button shrink-0"
                      disabled={closeDisabled}
                      aria-label="Close"
                    >
                      <X size={20} aria-hidden />
                    </button>
                  </div>
                </div>

                <div className={layout.bodyClassName}>
                  {children}
                </div>

                <div className={`${layout.footerClassName} ${footerError ? 'items-center' : ''}`} style={{ borderTop: '1px solid var(--app-border)' }}>
                  {footerError && (
                    <p className="col-span-2 text-sm font-medium sm:col-span-1 sm:mr-auto" style={{ color: 'var(--app-negative)' }}>
                      {footerError}
                    </p>
                  )}
                  <button
                    type="button"
                    className="app-secondary-button w-full sm:w-auto"
                    onClick={onClose}
                    disabled={submitDisabled}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${submitDisabled ? 'app-primary-button-loading justify-self-center sm:justify-self-auto' : submitWidthClassName}`}
                    disabled={submitDisabled}
                  >
                    {submitDisabled ? <div className="app-spinner" aria-label="Creating" /> : submitLabel}
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
