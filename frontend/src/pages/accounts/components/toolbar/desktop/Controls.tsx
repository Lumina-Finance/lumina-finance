import type { RefObject } from 'react'
import { Plus } from 'lucide-react'
import { AccountFilterPanel } from '@/pages/accounts/components/toolbar/FilterPanel'
import type { AccountFilterOptions, AccountFilterSetter } from '@/pages/accounts/components/toolbar/types'
import type { FilterValues } from '@/pages/accounts/types/accounts'

type DesktopAccountToolbarControlsProps = AccountFilterOptions & {
  filters: FilterValues
  setFilter: AccountFilterSetter
  desktopInlineLayout: boolean
  desktopCreateStacked: boolean
  controlsRef: RefObject<HTMLDivElement | null>
  filterGroupRef: RefObject<HTMLDivElement | null>
  createMeasureRef: RefObject<HTMLButtonElement | null>
  onAddAccount: () => void
}

/**
 * Renders the desktop account filters and add action while exposing measurement refs to the toolbar layout hook
 */
export function DesktopAccountToolbarControls({
  filters,
  setFilter,
  institutionOptions,
  kindOptions,
  typeOptions,
  desktopInlineLayout,
  desktopCreateStacked,
  controlsRef,
  filterGroupRef,
  createMeasureRef,
  onAddAccount,
}: DesktopAccountToolbarControlsProps) {
  return (
    <div
      ref={controlsRef}
      className={`relative hidden w-full flex-wrap items-center gap-3 min-[750px]:flex ${desktopInlineLayout ? 'min-[750px]:w-auto min-[750px]:flex-none min-[750px]:flex-nowrap' : ''}`}
    >
      <div
        ref={filterGroupRef}
        className={`flex min-w-0 flex-1 flex-wrap items-center gap-3 ${desktopInlineLayout ? 'min-[750px]:flex-none min-[750px]:flex-nowrap' : ''} ${desktopCreateStacked ? 'justify-between' : ''}`}
      >
        <AccountFilterPanel
          institutionOptions={institutionOptions}
          kindOptions={kindOptions}
          typeOptions={typeOptions}
          filters={filters}
          setFilter={setFilter}
        />
      </div>

      <button
        type="button"
        className={`app-glass-button-primary h-10 shrink-0 ${desktopCreateStacked ? 'basis-full justify-center' : 'w-auto'}`}
        onClick={onAddAccount}
      >
        <Plus size={18} aria-hidden />
        <span>Add Account</span>
      </button>
      <button
        ref={createMeasureRef}
        type="button"
        className="app-glass-button-primary pointer-events-none invisible absolute h-10 w-auto shrink-0"
        tabIndex={-1}
        aria-hidden
      >
        <Plus size={18} aria-hidden />
        <span>Add Account</span>
      </button>
    </div>
  )
}
