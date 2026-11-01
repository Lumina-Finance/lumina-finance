import { CreditCard, ListChecks, Repeat } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import { AppSlotMachineText } from '@/components/display/SlotMachineText'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'
import { HintButton } from '@/components/tooltips/HintButton'
import { DashboardWidgetHeaderIcon } from '@/pages/dashboard/components/WidgetHeaderIcon'
import type { CreditMode } from '@/pages/dashboard/utils/getCreditUsageSummary'
import { getCreditFxStatusMessage } from '@/utils/fxTooltipMessages'

type CreditHeaderProps = {
  creditMode: CreditMode
  hasCredit: boolean
  canChooseAccounts: boolean
  tierColor: string
  tierSoft: string
  fxStatus: FxStatus | undefined
  onModeToggle: () => void
  onChooseAccounts: () => void
}

/**
 * Renders the credit widget label, FX tooltip, account choice button, and used or remaining mode toggle
 */
export function CreditHeader({
  creditMode,
  hasCredit,
  canChooseAccounts,
  tierColor,
  tierSoft,
  fxStatus,
  onModeToggle,
  onChooseAccounts,
}: CreditHeaderProps) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <DashboardWidgetHeaderIcon icon={CreditCard} background={tierSoft} color={tierColor} />
      <span className="inline-flex min-w-0 items-center gap-2">
        <span className="app-label">
          Credit <AppSlotMachineText text={creditMode === 'used' ? 'used' : 'remaining'} />
        </span>
        <FxStatusBadge label="Credit FX status" fxStatus={fxStatus} getMessage={getCreditFxStatusMessage} />
      </span>
      <div className="ml-auto flex items-center gap-1">
        {hasCredit && (
          <HintButton
            onClick={onModeToggle}
            hint={creditMode === 'used' ? 'Show credit remaining' : 'Show credit used'}
            aria-label={creditMode === 'used' ? 'Show credit remaining' : 'Show credit used'}
            className="app-icon-button"
          >
            <Repeat size={12} />
          </HintButton>
        )}

        {/* Last, so it keeps its place at the right edge whether or not the mode toggle shows */}
        {canChooseAccounts && (
          <HintButton
            onClick={onChooseAccounts}
            hint="Choose credit accounts"
            aria-label="Choose credit accounts"
            className="app-icon-button"
          >
            <ListChecks size={12} aria-hidden />
          </HintButton>
        )}
      </div>
    </div>
  )
}
