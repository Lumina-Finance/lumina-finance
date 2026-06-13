import { useMemo, useState } from 'react'
import { useDashboardCredit } from '@/api/dashboard'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { CreditHeader } from '@/dashboard/components/CreditHeader'
import { CreditUsageBody } from '@/dashboard/components/CreditUsageBody'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
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
  const creditSummary = getCreditUsageSummary(dashboardCredit, creditMode)

  return (
    <div className="app-card h-[14rem] flex flex-col">
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
