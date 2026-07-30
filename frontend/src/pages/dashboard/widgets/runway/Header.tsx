import { LifeBuoy } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'
import { RunwayHelpTooltip } from '@/components/tooltips/RunwayHelpTooltip'
import { DashboardWidgetHeaderIcon } from '@/pages/dashboard/components/WidgetHeaderIcon'
import { getRunwayFxStatusMessage } from '@/utils/fxTooltipMessages'

type RunwayStyle = {
  label: string
  bg: string
  fg: string
}

type RunwayHeaderProps = {
  fxStatus: FxStatus | undefined
  runwayStyle: RunwayStyle | null
}

/**
 * Renders the runway label, calculation help, FX status, and runway band badge
 */
export function RunwayHeader({
  fxStatus,
  runwayStyle,
}: RunwayHeaderProps) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <DashboardWidgetHeaderIcon icon={LifeBuoy} />
      <span className="app-label">Runway</span>
      <RunwayHelpTooltip />
      <FxStatusBadge
        label="Runway FX status"
        fxStatus={fxStatus}
        getMessage={getRunwayFxStatusMessage}
      />
      {runwayStyle && (
        <span
          className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold max-[1000px]:text-[0.675rem]"
          style={{ background: runwayStyle.bg, color: runwayStyle.fg }}
        >
          {runwayStyle.label}
        </span>
      )}
    </div>
  )
}
