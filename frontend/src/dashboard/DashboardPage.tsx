import { useAuth } from '@/hooks/useAuth'
import { CreditWidget } from '@/dashboard/widgets/CreditWidget'
import { NetWorthWidget } from '@/dashboard/widgets/NetWorthWidget'
import { RecentActivityWidget } from '@/dashboard/widgets/RecentActivityWidget'
import { RunwayWidget } from '@/dashboard/widgets/RunwayWidget'
import { SavingsRateWidget } from '@/dashboard/widgets/SavingsRateWidget'
import { SpendingBreakdownWidget } from '@/dashboard/widgets/SpendingBreakdownWidget'
import { SpendingComparisonWidget } from '@/dashboard/widgets/SpendingComparisonWidget'
import { TopBudgetsWidget } from '@/dashboard/widgets/TopBudgetsWidget'
import { useDashboardGreeting } from '@/dashboard/hooks/useDashboardGreeting'

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
