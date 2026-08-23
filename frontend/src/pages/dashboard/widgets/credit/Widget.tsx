import { useMemo, useState } from 'react'
import { useDashboardCredit } from '@/api/dashboard'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'
import { CreditHeader } from './Header'
import { CreditUsageBody } from './UsageBody'
import { DashboardWidgetLoadingBody } from '@/pages/dashboard/components/WidgetLoadingBody'
import {
  getCreditUsageSummary,
  type CreditMode,
} from '@/pages/dashboard/utils/getCreditUsageSummary'

type CreditWidgetProps = {
  displayCurrency: string
}

/**
 * Loads credit utilization data and composes the active mode, header, progress ring, and amount
 */
export function CreditWidget({ displayCurrency }: CreditWidgetProps) {
  const {
    data: incomingDashboardCredit,
    error: creditError,
    isError: creditFailed,
    isFetching: dashboardCreditLoading,
  } = useDashboardCredit()
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
  const creditSummary = getCreditUsageSummary(dashboardCredit, creditMode)

  return (
    <div className="app-card h-[15.5rem] flex flex-col">
      <CreditHeader
        creditMode={creditMode}
        hasCredit={creditSummary.hasCredit}
        tierColor={creditSummary.tierColor}
        tierSoft={creditSummary.tierSoft}
        fxStatus={fxStatus}
        onModeToggle={() => setCreditMode((mode) => (mode === 'used' ? 'available' : 'used'))}
      />

      <DashboardWidgetLoadingBody
        contentConcealed={contentConcealed}
        error={creditError}
        failed={creditFailed}
        subject="Credit usage"
        loadingVisible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
        label="Loading credit"
        className="flex-1"
      >
        <CreditUsageBody
          summary={creditSummary}
          displayCurrency={displayCurrency}
        />
      </DashboardWidgetLoadingBody>
    </div>
  )
}
