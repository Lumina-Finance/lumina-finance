import { Wallet } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import { DashboardFxStatusTooltip } from '@/dashboard/components/DashboardFxStatusTooltip'
import { DashboardWidgetHeaderIcon } from '@/dashboard/components/DashboardWidgetHeaderIcon'
import { getNetWorthFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'

type NetWorthHeaderProps = {
  fxStatus: FxStatus | undefined
}

/**
 * Renders the net worth widget label and foreign exchange status tooltip
 */
export function NetWorthHeader({ fxStatus }: NetWorthHeaderProps) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <DashboardWidgetHeaderIcon icon={Wallet} />
      <span className="app-label">Net Worth</span>
      <DashboardFxStatusTooltip
        label="Net worth FX status"
        fxStatus={fxStatus}
        getMessage={getNetWorthFxStatusMessage}
      />
    </div>
  )
}
