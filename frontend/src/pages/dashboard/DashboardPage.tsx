import { useAuth } from '@/hooks/useAuth'
import { CreditWidget } from '@/pages/dashboard/widgets/credit/CreditWidget'
import { NetWorthWidget } from '@/pages/dashboard/widgets/net-worth/NetWorthWidget'
import { RecentActivityWidget } from '@/pages/dashboard/widgets/recent-activity/RecentActivityWidget'
import { RunwayWidget } from '@/pages/dashboard/widgets/runway/RunwayWidget'
import { SavingsRateWidget } from '@/pages/dashboard/widgets/savings-rate/SavingsRateWidget'
import { SpendingBreakdownWidget } from '@/pages/dashboard/widgets/spending-breakdown/SpendingBreakdownWidget'
import { SpendingComparisonWidget } from '@/pages/dashboard/widgets/spending-comparison/SpendingComparisonWidget'
import { TopBudgetsWidget } from '@/pages/dashboard/widgets/top-budgets/TopBudgetsWidget'
import { useDashboardGreeting } from '@/pages/dashboard/hooks/useDashboardGreeting'

/**
 * Composes the dashboard greeting and financial overview widgets
 */
export default function DashboardPage() {
  const { greeting, subtitle } = useDashboardGreeting()
  const { user } = useAuth()
  const displayCurrency = user!.base_currency

  return (
    <div>
      <header className="app-page-header">
        <h1 className="app-page-title">
          {greeting}
        </h1>
        <p className="app-page-description">{subtitle}</p>
      </header>

      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 min-[730px]:grid-cols-2 min-[1750px]:grid-cols-4">
          <NetWorthWidget displayCurrency={displayCurrency} />
          <CreditWidget displayCurrency={displayCurrency} />
          <SavingsRateWidget />
          <RunwayWidget displayCurrency={displayCurrency} />
        </div>

        <div className="grid grid-cols-1 gap-4 min-[1001px]:grid-cols-2">
          <SpendingComparisonWidget displayCurrency={displayCurrency} />
          <SpendingBreakdownWidget displayCurrency={displayCurrency} />
        </div>

        <div className="grid grid-cols-1 gap-4 min-[1001px]:grid-cols-2">
          <TopBudgetsWidget />
          <RecentActivityWidget />
        </div>
      </div>
    </div>
  )
}
