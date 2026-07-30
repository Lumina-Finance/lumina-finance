import { type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, PiggyBank } from 'lucide-react'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import type { ModalLevel } from '@/components/modal/Shell'

// The category picker and the period fields sit side by side on a wide screen, which needs more room than
// the usual form panel
const PANEL_WIDTH_CLASS_NAME = 'max-w-5xl'

interface BudgetEditorModalShellProps {
  open: boolean
  title: string
  titleId: string
  eyebrow: string
  headerStatus?: string
  sideLabel: string
  warning?: string
  formError: string | null
  /** Stacked where the editor opens over a budget's details, page where it opens from the budgets list */
  level: ModalLevel
  footer: ReactNode
  children: ReactNode
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

/**
 * The modal shared by the create and edit budget forms, adding the warning banner and the form-level error
 * that both of them show around their fields
 */
export default function BudgetEditorModalShell({
  open,
  title,
  titleId,
  eyebrow,
  headerStatus,
  sideLabel,
  warning,
  formError,
  level,
  footer,
  children,
  onClose,
  onSubmit,
}: BudgetEditorModalShellProps) {
  return (
    <ModalTitledPanel
      open={open}
      titleId={titleId}
      title={title}
      eyebrow={eyebrow}
      headerStatus={headerStatus}
      RailIcon={PiggyBank}
      railLabel={sideLabel}
      widthClassName={PANEL_WIDTH_CLASS_NAME}
      level={level}
      footer={footer}
      onClose={onClose}
      onSubmit={onSubmit}
    >
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
    </ModalTitledPanel>
  )
}
