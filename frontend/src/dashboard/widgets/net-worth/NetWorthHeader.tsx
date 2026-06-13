import { Wallet } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import { DashboardFxStatusTooltip } from '@/dashboard/components/DashboardFxStatusTooltip'
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
      <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
        <Wallet size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
      </div>
      <span className="app-label">Net Worth</span>
      <DashboardFxStatusTooltip
        label="Net worth FX status"
        fxStatus={fxStatus}
        getMessage={getNetWorthFxStatusMessage}
      />
    </div>
  )
}
