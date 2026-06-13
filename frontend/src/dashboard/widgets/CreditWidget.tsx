import { useMemo, useState } from 'react'
import { useDashboardCredit } from '@/api/dashboard'
import { AppScrambledNumber } from '@/components/AppScrambledNumber'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { CreditHeader } from '@/dashboard/components/CreditHeader'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import { formatDashboardMoney } from '@/dashboard/utils/formatDashboardMoney'
import {
  getCreditUsageSummary,
  type CreditMode,
} from '@/dashboard/utils/getCreditUsageSummary'

type CreditWidgetProps = {
  displayCurrency: string
}

/**
 * Loads credit utilization data and composes the active mode, header, progress ring, and amount
 */
export function CreditWidget({ displayCurrency }: CreditWidgetProps) {
  const { data: incomingDashboardCredit, isFetching: dashboardCreditLoading } = useDashboardCredit()
  const [creditMode, setCreditMode] = useState<CreditMode>('used')
  const loadingSnapshot = useMemo(
    () => ({ dashboardCredit: incomingDashboardCredit }),
    [incomingDashboardCredit],
  )
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot({
    snapshot: loadingSnapshot,
    loading: dashboardCreditLoading,
    transitionKey: 'credit',
  })
  const dashboardCredit = displaySnapshot.dashboardCredit
  const fxStatus = dashboardCredit?.fx_status
  const {
    creditAvailable,
    displayAmount,
    displayPct,
    hasCredit,
    tierColor,
    tierSoft,
  } = getCreditUsageSummary(dashboardCredit, creditMode)

  const size = 120
  const strokeWidth = 10
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const filled = (Math.max(0, Math.min(displayPct, 100)) / 100) * circumference

  return (
    <div className="app-card h-[14rem] flex flex-col">
      <CreditHeader
        creditMode={creditMode}
        hasCredit={hasCredit}
        tierColor={tierColor}
        tierSoft={tierSoft}
        fxStatus={fxStatus}
        onModeToggle={() => setCreditMode((mode) => (mode === 'used' ? 'available' : 'used'))}
      />

      <DashboardWidgetLoadingBody
        contentConcealed={contentConcealed}
        loadingVisible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
        label="Loading credit"
        className="flex-1"
      >
        {hasCredit ? (
          <div className="flex h-full min-h-0 items-center justify-center gap-4">
            <div className="relative aspect-square h-full shrink-0">
              <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
                <circle
                  cx={size / 2} cy={size / 2} r={radius}
                  fill="none"
                  stroke="var(--app-border)"
                  strokeWidth={strokeWidth}
                />
                <circle
                  cx={size / 2} cy={size / 2} r={radius}
                  fill="none"
                  stroke={tierColor}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference - filled}
                  style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1)' }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="font-financial text-2xl font-medium tracking-tight max-[1000px]:text-[1.35rem]">
                  <AppScrambledNumber text={`${displayPct}%`} />
                </span>
              </div>
            </div>
            <div className="min-w-0">
              <p className="font-financial text-3xl font-normal leading-none tracking-tight max-[1000px]:text-[1.6875rem]">
                <AppScrambledNumber text={formatDashboardMoney(displayAmount, displayCurrency, 'credit')} />
              </p>
              <p className="font-financial mt-1.5 text-sm max-[1000px]:text-[0.7875rem]" style={{ color: 'var(--app-text-muted)' }}>
                of <AppScrambledNumber text={formatDashboardMoney(creditAvailable, displayCurrency, 'credit')} />
              </p>
            </div>
          </div>
        ) : (
          <p
            className="flex h-full items-center justify-center text-center text-sm italic max-[1000px]:text-[0.7875rem]"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            No credit accounts
          </p>
        )}
      </DashboardWidgetLoadingBody>
    </div>
  )
}
