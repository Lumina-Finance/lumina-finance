import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, PiggyBank, X } from 'lucide-react'
import { useModalFieldFocus } from '@/components/modal/useModalFieldFocus'
import { EASE } from '@/pages/budgets/constants'

type SurfaceMotion = {
  opacity: number
  scale: number
  y: number
}

export interface BudgetEditorModalShellAppearance {
  backdropClassName: string
  backdropStyle: CSSProperties
  backdropDuration: number
  stageClassName: string
  panelClassName: string
  surfaceInitial: SurfaceMotion
  surfaceExit: SurfaceMotion
  surfaceDuration: number
  sideRailClassName: string
  sideRailStyle: CSSProperties
  sideRailIconSize: number
  sideLabelClassName: string
  headerClassName: string
  bodyClassName: string
}

interface BudgetEditorModalShellProps {
  open: boolean
  title: string
  titleId: string
  eyebrow: string
  sideLabel: string
  warning?: string
  formError: string | null
  appearance: BudgetEditorModalShellAppearance
  footer: ReactNode
  children: ReactNode
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

/**
 * Provides the animated modal shell shared by create and edit budget workflows
 */
export default function BudgetEditorModalShell({
  open,
  title,
  titleId,
  eyebrow,
  sideLabel,
  warning,
  formError,
  appearance,
  footer,
  children,
  onClose,
  onSubmit,
}: BudgetEditorModalShellProps) {
  const { panelRef, handleModalFieldKeyDown } = useModalFieldFocus(open)

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className={appearance.backdropClassName}
            style={appearance.backdropStyle}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: appearance.backdropDuration }}
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
            aria-hidden
          />

          <motion.div
            className={appearance.stageClassName}
            initial={appearance.surfaceInitial}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={appearance.surfaceExit}
            transition={{
              duration: appearance.surfaceDuration,
              ease: EASE,
            }}
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
          >
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className={appearance.panelClassName}
              style={{
                background: 'var(--app-bg)',
                border: '1px solid var(--app-border-strong)',
                boxShadow: 'var(--app-shadow-soft)',
              }}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={handleModalFieldKeyDown}
            >
              <div
                className={appearance.sideRailClassName}
                style={appearance.sideRailStyle}
                aria-hidden
              >
                <PiggyBank size={appearance.sideRailIconSize} strokeWidth={2} />
                <span className={appearance.sideLabelClassName} style={{ writingMode: 'vertical-rl' }}>
                  {sideLabel}
                </span>
              </div>

              <form onSubmit={onSubmit} className="flex min-h-0 w-full flex-col" noValidate>
                <div className={appearance.headerClassName} style={{ borderBottom: '1px solid var(--app-border)' }}>
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                        {eyebrow}
                      </p>
                      <h2 id={titleId} className="font-serif text-3xl font-light">
                        {title}
                      </h2>
                    </div>
                    <button type="button" className="app-icon-button shrink-0" aria-label="Close" onClick={onClose}>
                      <X size={20} aria-hidden />
                    </button>
                  </div>
                </div>

                <div className={appearance.bodyClassName}>
                  {warning && (
                    <div
                      className="mb-5 flex items-start gap-3 rounded-lg px-4 py-3 text-sm"
                      style={{
                        background: 'var(--app-warning-soft)',
                        border: '1px solid var(--app-warning)',
                        color: 'var(--app-warning-text)',
                      }}
                    >
                      <CircleAlert className="mt-0.5 shrink-0" size={18} aria-hidden />
                      <p className="leading-6">{warning}</p>
                    </div>
                  )}

                  {children}

                  <AnimatePresence>
                    {formError && (
                      <motion.p
                        className="mt-4 text-sm font-medium"
                        style={{ color: 'var(--app-negative)' }}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                      >
                        {formError}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                {footer}
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}
