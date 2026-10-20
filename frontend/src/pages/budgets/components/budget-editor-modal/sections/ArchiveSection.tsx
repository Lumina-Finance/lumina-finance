import { EyeOff } from 'lucide-react'
import { Switch } from '@/components/forms/Switch'

const ARCHIVE_FIELD_ID = 'budget-edit-archive'

interface BudgetEditorModalArchiveSectionProps {
  isArchived: boolean
  onToggle: (checked: boolean) => void
}

/**
 * Renders the archive toggle that stages a budget's archived state for the next save
 *
 * Archived budgets stay in spending aggregates, so no balance-adjustment warning is shown
 */
export default function BudgetEditorModalArchiveSection({
  isArchived,
  onToggle,
}: BudgetEditorModalArchiveSectionProps) {
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 min-[1050px]:gap-x-3">
      <div className="flex min-h-0 flex-col items-center">
        <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
          03
        </span>
        <span
          className="mt-1 w-px flex-1"
          style={{ backgroundColor: 'var(--app-border-strong)' }}
          aria-hidden
        />
      </div>

      <div className="min-w-0 space-y-3">
        <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Archive</p>

        <label
          htmlFor={ARCHIVE_FIELD_ID}
          className="flex cursor-pointer items-center justify-between gap-4 rounded-xl p-4"
          style={{
            background: 'var(--app-input-bg)',
            border: '1px solid var(--app-input-border)',
          }}
        >
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-medium">
              <EyeOff size={16} style={{ color: 'var(--app-text-muted)' }} aria-hidden />
              Archive budget
            </span>
            <span className="mt-0.5 block text-sm" style={{ color: 'var(--app-text-muted)' }}>
              Move this budget out of active lists while keeping its history.
            </span>
          </span>
          <Switch id={ARCHIVE_FIELD_ID} checked={isArchived} onChange={onToggle} />
        </label>
      </div>
    </div>
  )
}
