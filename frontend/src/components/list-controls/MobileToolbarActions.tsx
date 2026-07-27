import { Plus, SlidersHorizontal } from 'lucide-react'

type MobileToolbarActionsProps = {
  activeFilterCount: number
  onOpenFilters: () => void
  onPrimaryAction: () => void
  // Accessible name for the primary action, shown while it is enabled
  primaryLabel: string
  primaryDisabled?: boolean
  // Shown as the button's title and accessible name in place of primaryLabel while disabled
  primaryDisabledReason?: string
}

/**
 * Renders the mobile toolbar action row shared by the account and transaction lists: the filters
 * button with its active-count badge, and the list's primary create action
 */
export function MobileToolbarActions({
  activeFilterCount,
  onOpenFilters,
  onPrimaryAction,
  primaryLabel,
  primaryDisabled = false,
  primaryDisabledReason,
}: MobileToolbarActionsProps) {
  return (
    <div className="flex w-full items-center gap-3 min-[750px]:hidden">
      <button
        type="button"
        className="app-glass-button h-11 min-w-0 flex-1 justify-between"
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
        className="app-glass-button-primary h-11 w-11 shrink-0 px-0"
        onClick={onPrimaryAction}
        disabled={primaryDisabled}
        title={primaryDisabledReason}
        aria-label={primaryDisabledReason ?? primaryLabel}
      >
        <Plus size={18} aria-hidden />
      </button>
    </div>
  )
}
