import type { ReactNode, RefObject } from 'react'
import { Plus } from 'lucide-react'

type DesktopToolbarControlsProps = {
  controlsRef: RefObject<HTMLDivElement | null>
  filterGroupRef: RefObject<HTMLDivElement | null>
  createMeasureRef: RefObject<HTMLButtonElement | null>
  desktopInlineLayout: boolean
  desktopCreateStacked: boolean
  // The domain-specific filter glass panel slotted into the filter group
  filterPanel: ReactNode
  createLabel: string
  onCreate: () => void
  createDisabled?: boolean
  createDisabledReason?: string
}

/**
 * Renders the desktop toolbar's filter slot and create action shared by the account and transaction
 * lists, plus the hidden measurement twin of the create button the toolbar layout hook reads to
 * decide when the row wraps
 */
export function DesktopToolbarControls({
  controlsRef,
  filterGroupRef,
  createMeasureRef,
  desktopInlineLayout,
  desktopCreateStacked,
  filterPanel,
  createLabel,
  onCreate,
  createDisabled = false,
  createDisabledReason,
}: DesktopToolbarControlsProps) {
  return (
    <div
      ref={controlsRef}
      className={`relative hidden w-full flex-wrap items-center gap-3 min-[750px]:flex ${desktopInlineLayout ? 'min-[750px]:w-auto min-[750px]:flex-none min-[750px]:flex-nowrap' : ''}`}
    >
      <div
        ref={filterGroupRef}
        className={`flex min-w-0 flex-1 flex-wrap items-center gap-3 ${desktopInlineLayout ? 'min-[750px]:flex-none min-[750px]:flex-nowrap' : ''} ${desktopCreateStacked ? 'justify-between' : ''}`}
      >
        {filterPanel}
      </div>

      <button
        type="button"
        className={`app-glass-button-primary h-10 shrink-0 ${desktopCreateStacked ? 'basis-full justify-center' : 'w-auto'}`}
        onClick={onCreate}
        disabled={createDisabled}
        title={createDisabledReason}
      >
        <Plus size={18} aria-hidden />
        <span>{createLabel}</span>
      </button>
      <button
        ref={createMeasureRef}
        type="button"
        className="app-glass-button-primary pointer-events-none invisible absolute h-10 w-auto shrink-0"
        tabIndex={-1}
        aria-hidden
      >
        <Plus size={18} aria-hidden />
        <span>{createLabel}</span>
      </button>
    </div>
  )
}
