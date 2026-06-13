import { InsightFxStatusBadge } from '@/pages/insights/components/InsightFxStatusBadge'
import { InsightCalculationTooltip } from '@/pages/insights/components/InsightCalculationTooltip'
import type { PeriodGlanceSupportItem } from '@/pages/insights/types/periodGlance'
import {
  getPeriodGlanceToneClass,
  PERIOD_GLANCE_TITLE_CONTROL_SLOT_CLASS,
} from './display'

type PeriodGlanceSupportGridProps = {
  supportItems: PeriodGlanceSupportItem[]
}

/**
 * Renders the secondary period-glance metrics in a responsive grid
 */
export function PeriodGlanceSupportGrid({ supportItems }: PeriodGlanceSupportGridProps) {
  return (
    <div className="grid min-[750px]:grid-cols-[minmax(0,40fr)_minmax(0,60fr)]">
      {supportItems.map((item, index) => (
        <div
          key={item.label}
          className={[
            'border-[var(--app-border)] py-4 min-[750px]:p-4',
            index < supportItems.length - 1 ? 'border-b' : '',
            index === 0 ? 'pt-0 min-[750px]:border-r min-[750px]:pl-0 min-[750px]:pt-0' : '',
            index === 1 ? 'min-[750px]:pr-0 min-[750px]:pt-0' : '',
            index === 2
              ? 'min-[750px]:border-b-0 min-[750px]:border-r min-[750px]:pb-0 min-[750px]:pl-0'
              : '',
            index === 3 ? 'pb-0 min-[750px]:pr-0' : '',
          ].join(' ')}
        >
          <div className="flex min-h-28 flex-col items-center justify-center text-center">
            <p className="app-label inline-flex items-center justify-center gap-2">
              <span className={`${PERIOD_GLANCE_TITLE_CONTROL_SLOT_CLASS} justify-end`}>
                {item.fxStatus && (
                  <InsightFxStatusBadge
                    label={`${item.label} FX status`}
                    status={item.fxStatus}
                    getMessage={item.getFxStatusMessage}
                  />
                )}
              </span>
              {item.label}
              <span className={`${PERIOD_GLANCE_TITLE_CONTROL_SLOT_CLASS} justify-start`}>
                <InsightCalculationTooltip
                  label={item.label}
                  calculation={item.calculation}
                />
              </span>
            </p>
            <p
              className={['mt-1 text-2xl font-semibold leading-tight', getPeriodGlanceToneClass(item.tone)].join(' ')}
            >
              {item.value}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
              {item.detail}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
