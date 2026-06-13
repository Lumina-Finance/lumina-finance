import { Plus, SlidersHorizontal } from 'lucide-react'

type MobileToolbarActionsProps = {
  activeFilterCount: number
  onOpenFilters: () => void
  onCreateTransaction: () => void
  createDisabled: boolean
  createDisabledReason?: string
}

/**
 * Renders the mobile toolbar action row below transaction search
 */
export function MobileToolbarActions({
  activeFilterCount,
  onOpenFilters,
  onCreateTransaction,
  createDisabled,
  createDisabledReason,
}: MobileToolbarActionsProps) {
  return (
    <div className="flex w-full items-center gap-3 min-[750px]:hidden">
      <button
        type="button"
        className="app-secondary-button h-11 min-w-0 flex-1 justify-between"
        onClick={onOpenFilters}
      >
        <span className="flex min-w-0 items-center gap-2">
          <SlidersHorizontal size={17} aria-hidden />
          <span>Filters</span>
        </span>
        {activeFilterCount > 0 && (
          <span
            className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold"
            style={{
              background: 'var(--app-accent-soft)',
              color: 'var(--app-accent)',
            }}
          >
            {activeFilterCount}
          </span>
        )}
      </button>

      <button
        type="button"
        className="app-primary-button h-11 w-11 shrink-0 px-0"
        onClick={onCreateTransaction}
        disabled={createDisabled}
        title={createDisabledReason}
        aria-label={createDisabledReason ?? 'Add transaction'}
      >
        <Plus size={18} aria-hidden />
      </button>
    </div>
  )
}
