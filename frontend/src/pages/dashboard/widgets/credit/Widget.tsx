import { useMemo, useState } from 'react'
import { useDashboardCreditUtilization } from '@/api/dashboard'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'
import { CreditAccountsModal } from './AccountsModal'
import { CreditHeader } from './Header'
import { CreditUsageBody } from './UsageBody'
import { DashboardWidgetLoadingBody } from '@/pages/dashboard/components/WidgetLoadingBody'
import { areAllAccountsLeftOut } from '@/pages/dashboard/utils/creditAccountChoice'
import {
  getCreditUsageSummary,
  type CreditMode,
} from '@/pages/dashboard/utils/getCreditUsageSummary'

type CreditWidgetProps = {
  displayCurrency: string
}

/**
 * Loads credit utilization data for the accounts the user counts and composes the active mode, header,
 * account choice, progress ring, and amount
 */
export function CreditWidget({ displayCurrency }: CreditWidgetProps) {
  const {
    data: incomingDashboardCredit,
    error: creditError,
    isError: creditFailed,
    isFetching: dashboardCreditLoading,
  } = useDashboardCreditUtilization()
  const [creditMode, setCreditMode] = useState<CreditMode>('used')
  const [accountsModalOpen, setAccountsModalOpen] = useState(false)
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
  const creditAccounts = dashboardCredit?.accounts ?? []

  return (
    <div className="app-card h-[15.5rem] flex flex-col">
      <CreditHeader
        creditMode={creditMode}
        hasCredit={creditSummary.hasCredit}
        canChooseAccounts={creditAccounts.length > 0}
        tierColor={creditSummary.tierColor}
        tierSoft={creditSummary.tierSoft}
        fxStatus={fxStatus}
        onModeToggle={() => setCreditMode((mode) => (mode === 'used' ? 'available' : 'used'))}
        onChooseAccounts={() => setAccountsModalOpen(true)}
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
          allLeftOut={areAllAccountsLeftOut(creditAccounts)}
          onChooseAccounts={() => setAccountsModalOpen(true)}
        />
      </DashboardWidgetLoadingBody>

      <CreditAccountsModal
        open={accountsModalOpen}
        accounts={creditAccounts}
        onClose={() => setAccountsModalOpen(false)}
      />
    </div>
  )
}
