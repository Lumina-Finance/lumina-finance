import type { ReactNode } from 'react'
import type { FxStatus } from '@/api/shared/fx'
import { FxStatusTooltip } from '@/components/FxStatusTooltip'
import AccountsLoadingRegion from '@/pages/accounts/components/AccountsLoadingRegion'

type MetricPanelProps = {
  className: string
  label: string
  tooltipLabel: string
  fxStatus: FxStatus | undefined
  getMessage: (fxStatus: FxStatus) => string
  loading: boolean
  loadingLabel: string
  value: string
  valueColor: string
  progress: number
  progressColor: string
  caption: string
  badge?: ReactNode
  headerClassName?: string
}

/**
 * Renders one accounts metric with consistent loading, tooltip, and progress styling
 */
export function MetricPanel({
  className,
  label,
  tooltipLabel,
  fxStatus,
  getMessage,
  loading,
  loadingLabel,
  value,
  valueColor,
  progress,
  progressColor,
  caption,
  badge,
  headerClassName = '',
}: MetricPanelProps) {
  return (
    <div className={className}>
      <div className={`mb-1 flex items-center gap-2 ${headerClassName}`}>
        <p className="app-label">{label}</p>
        <FxStatusTooltip
          label={tooltipLabel}
          fxStatus={fxStatus}
          getMessage={getMessage}
        />
      </div>
      {badge}
      <AccountsLoadingRegion
        loading={loading}
        label={loadingLabel}
        className="rounded-lg"
      >
        <p
          className="font-financial text-[clamp(1rem,1.7vw,1.5rem)] font-semibold"
          style={{ color: valueColor }}
        >
          {value}
        </p>
        <div className="mt-2 space-y-1">
          <div
            className="h-1 overflow-hidden rounded-full"
            style={{ background: 'var(--app-border)' }}
          >
            <div
              className="h-full rounded-full"
              style={{
                background: progressColor,
                width: `${progress}%`,
              }}
            />
          </div>
          <p
            className="font-financial text-[clamp(0.875rem,1vw,0.9375rem)]"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            {caption}
          </p>
        </div>
      </AccountsLoadingRegion>
    </div>
  )
}
