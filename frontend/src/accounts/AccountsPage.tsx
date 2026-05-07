import { useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useAccounts } from '@/api/accounts'
import { useTaxAdvantagedPlans } from '@/api/taxAdvantagedPlans'
import { accountKeys, dashboardKeys, taxAdvantagedPlanKeys } from '@/api/queryKeys'
import { useFocusRefetch } from '@/hooks/useFocusRefetch'
import CreateAccountModal from '@/components/CreateAccountModal'
import AccountFilters from '@/accounts/components/AccountFilters'
import AccountListSection from '@/accounts/components/AccountListSection'
import AccountSummaryStatement from '@/accounts/components/AccountSummaryStatement'
import AccountsMetricsBand from '@/accounts/components/AccountsMetricsBand'
import HiddenAccountsSection from '@/accounts/components/HiddenAccountsSection'
import TaxAdvantagedLimitsSection from '@/accounts/components/TaxAdvantagedLimitsSection'
import { useAccountFilters } from '@/accounts/hooks/useAccountFilters'
import { useAccountSections } from '@/accounts/hooks/useAccountSections'
import { useAccountsMetrics } from '@/accounts/hooks/useAccountsMetrics'
import { useTaxAdvantagedLimitSummaries } from '@/accounts/hooks/useTaxAdvantagedLimitSummaries'

export default function AccountsPage() {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const { user } = useAuth()
  const { data: accounts, isLoading, error } = useAccounts()
  const { data: taxAdvantagedPlans } = useTaxAdvantagedPlans()

  useFocusRefetch([
    accountKeys.list(),
    { queryKey: dashboardKeys.savingsRateAll, exact: false },
    taxAdvantagedPlanKeys.list(),
  ])

  const allRows = useMemo(() => accounts ?? [], [accounts])
  const rows = useMemo(() => allRows.filter((account) => !account.is_hidden), [allRows])
  const hiddenRows = useMemo(() => allRows.filter((account) => account.is_hidden), [allRows])
  const displayCurrency = user!.base_currency

  const {
    filters,
    setFilter,
    institutionOptions,
    accountKindOptions,
    accountTypeOptions,
    filteredRows,
  } = useAccountFilters(rows)
  const accountSections = useAccountSections({ rows, filteredRows })
  const accountMetrics = useAccountsMetrics(rows, displayCurrency)
  const { taxAdvantagedPlanById, taxAdvantagedLimitSummaries } =
    useTaxAdvantagedLimitSummaries({
      rows,
      filteredRows,
      taxAdvantagedPlans,
    })

  return (
    <div>
      <header className="app-page-header">
        <h1 className="app-page-title">My Accounts</h1>
      </header>

      <div className="space-y-4">
        <AccountSummaryStatement
          error={error}
          isLoading={isLoading}
          netWorth={accountSections.netWorth}
          totalAssets={accountSections.totalAssets}
          totalDebts={accountSections.totalDebts}
          assetCount={accountSections.assetCount}
          debtCount={accountSections.debtCount}
          displayCurrency={displayCurrency}
        />

        <AccountsMetricsBand metrics={accountMetrics} displayCurrency={displayCurrency} />

        <TaxAdvantagedLimitsSection summaries={taxAdvantagedLimitSummaries} />

        <AccountFilters
          filters={filters}
          setFilter={setFilter}
          institutionOptions={institutionOptions}
          accountKindOptions={accountKindOptions}
          accountTypeOptions={accountTypeOptions}
          onAddAccount={() => {
            setCreateModalKey((key) => key + 1)
            setShowCreateModal(true)
          }}
        />

        <AccountListSection
          title="Assets"
          accent="positive"
          accounts={accountSections.assetRows}
          subtotal={accountSections.totalAssets}
          emptyLabel="No asset accounts"
          displayCurrency={displayCurrency}
          taxAdvantagedPlanById={taxAdvantagedPlanById}
        />

        <AccountListSection
          title="Revolving credit"
          accent="negative"
          accounts={accountSections.revolvingRows}
          subtotal={accountSections.revolvingSubtotal}
          emptyLabel="No revolving credit accounts"
          displayCurrency={displayCurrency}
          taxAdvantagedPlanById={taxAdvantagedPlanById}
          showCreditLimit
        />

        <AccountListSection
          title="Amortizing debt"
          accent="negative"
          accounts={accountSections.amortizingRows}
          subtotal={accountSections.amortizingSubtotal}
          emptyLabel="No amortizing debt accounts"
          displayCurrency={displayCurrency}
          taxAdvantagedPlanById={taxAdvantagedPlanById}
        />

        <HiddenAccountsSection
          accounts={hiddenRows}
          displayCurrency={displayCurrency}
          taxAdvantagedPlanById={taxAdvantagedPlanById}
        />
      </div>

      <CreateAccountModal
        key={createModalKey}
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </div>
  )
}
