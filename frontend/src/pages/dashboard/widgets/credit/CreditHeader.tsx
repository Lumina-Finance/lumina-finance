import { CreditCard, Repeat } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import { FxStatusTooltip } from '@/components/FxStatusTooltip'
import { DashboardWidgetHeaderIcon } from '@/pages/dashboard/components/DashboardWidgetHeaderIcon'
import type { CreditMode } from '@/pages/dashboard/utils/getCreditUsageSummary'
import { getCreditFxStatusMessage } from '@/utils/fxTooltipMessages'

type CreditHeaderProps = {
  creditMode: CreditMode
  hasCredit: boolean
  tierColor: string
  tierSoft: string
  fxStatus: FxStatus | undefined
  onModeToggle: () => void
}

/**
 * Renders the credit widget label, FX tooltip, and used or remaining mode toggle
 */
export function CreditHeader({
  creditMode,
  hasCredit,
  tierColor,
  tierSoft,
  fxStatus,
  onModeToggle,
}: CreditHeaderProps) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <DashboardWidgetHeaderIcon icon={CreditCard} background={tierSoft} color={tierColor} />
      <span className="inline-flex min-w-0 items-center gap-2">
        <span className="app-label">
          Credit <AppSlotMachineText text={creditMode === 'used' ? 'Used' : 'Remaining'} />
        </span>
        <FxStatusTooltip
          label="Credit FX status"
          fxStatus={fxStatus}
          getMessage={getCreditFxStatusMessage}
        />
      </span>
      {hasCredit && (
        <button
          type="button"
          onClick={onModeToggle}
          title={creditMode === 'used' ? 'Show credit remaining' : 'Show credit used'}
          aria-label={creditMode === 'used' ? 'Show credit remaining' : 'Show credit used'}
          className="app-icon-button ml-auto"
        >
          <Repeat size={12} />
        </button>
      )}
    </div>
  )
}
