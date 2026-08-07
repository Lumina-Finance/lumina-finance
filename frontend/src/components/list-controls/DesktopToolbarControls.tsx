import type { ReactNode, RefObject } from 'react'
import { Plus } from 'lucide-react'

type DesktopToolbarControlsProps = {
  controlsRef: RefObject<HTMLDivElement | null>
  filterGroupRef: RefObject<HTMLDivElement | null>
  createMeasureRef: RefObject<HTMLDivElement | null>
  desktopInlineLayout: boolean
  desktopCreateStacked: boolean
  // The domain-specific filter glass panel slotted into the filter group
  filterPanel: ReactNode
  createLabel: string
  onCreate: () => void
  createDisabled?: boolean
  createDisabledReason?: string

  // An action shown ahead of the create button, for a list that has a second thing to offer
  secondaryAction?: ReactNode
}

/**
 * Renders the desktop toolbar's filter slot and create action shared by the account and transaction
 * lists, plus the hidden measurement twin of both the layout hook reads to decide when the row wraps
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
  secondaryAction,
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

      {secondaryAction}

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

      {/* What the layout hook measures, so it has to hold everything the row actually draws after
          the filters, at the same gap. Measuring the create button alone once a second button sat
          beside it would report a row narrower than it renders, and the row would stay on one line
          where it no longer fits rather than wrapping. Hidden on the wrapper rather than on each
          copy inside it, which also takes the whole subtree out of the tab order and off the
          accessibility tree, so the copy of a real action in here is neither clickable nor
          reachable. Rendered whether or not there is a secondary action, since the hook gives up
          for good when it finds no element on its first pass */}
      <div
        ref={createMeasureRef}
        className="pointer-events-none invisible absolute flex shrink-0 items-center gap-3"
        aria-hidden
      >
        {secondaryAction}
        <button type="button" className="app-glass-button-primary h-10 w-auto shrink-0" tabIndex={-1}>
          <Plus size={18} aria-hidden />
          <span>{createLabel}</span>
        </button>
      </div>
    </div>
  )
}
