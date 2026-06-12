import { useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useAccounts } from '@/api/accounts'
import { useTaxAdvantagedCategories } from '@/api/taxAdvantagedCategories'
import CreateAccountModal from '@/components/CreateAccountModal'
import AccountFilters from '@/accounts/components/AccountFilters'
import AccountListSection from '@/accounts/components/AccountListSection'
import AccountSummaryStatement from '@/accounts/components/AccountSummaryStatement'
import AccountsMetricsBand from '@/accounts/components/AccountsMetricsBand'
import ArchivedAccountsSection from '@/accounts/components/ArchivedAccountsSection'
import TaxAdvantagedLimitsSection from '@/accounts/components/TaxAdvantagedLimitsSection'
import { useAccountFilters } from '@/accounts/hooks/useAccountFilters'
import { useAccountSections } from '@/accounts/hooks/useAccountSections'
import { useAccountsMetrics } from '@/accounts/hooks/useAccountsMetrics'
import { useTaxAdvantagedLimitSummaries } from '@/accounts/hooks/useTaxAdvantagedLimitSummaries'

export default function AccountsPage() {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const { user } = useAuth()
  const { data: accounts, isFetching: accountsLoading, error } = useAccounts()
  const { data: taxAdvantagedCategories } = useTaxAdvantagedCategories()

  const allRows = useMemo(() => accounts ?? [], [accounts])
  const rows = useMemo(() => allRows.filter((account) => !account.is_archived), [allRows])
  const archivedRows = useMemo(() => allRows.filter((account) => account.is_archived), [allRows])
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
  const { taxAdvantagedCategoryById, taxAdvantagedLimitSummaries } =
    useTaxAdvantagedLimitSummaries({
      rows,
      filteredRows,
      taxAdvantagedCategories,
    })

  return (
    <div>
      <header className="app-page-header">
        <h1 className="app-page-title">My Accounts</h1>
        <p className="app-page-description">
          Review balances, account groups, contribution limits, and archived accounts in one place.
        </p>
      </header>

      <div className="space-y-4">
        <AccountSummaryStatement
          error={error}
          isLoading={accountsLoading}
          netWorth={accountSections.netWorth}
          totalAssets={accountSections.totalAssets}
          totalDebts={accountSections.totalDebts}
          assetCount={accountSections.assetCount}
          debtCount={accountSections.debtCount}
          displayCurrency={displayCurrency}
          fxStatus={accountSections.fxStatus}
        />

        <div>
          <AccountsMetricsBand metrics={accountMetrics} displayCurrency={displayCurrency} />
          <TaxAdvantagedLimitsSection summaries={taxAdvantagedLimitSummaries} />
        </div>

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
          taxAdvantagedCategoryById={taxAdvantagedCategoryById}
          loading={accountsLoading}
        />

        <AccountListSection
          title="Revolving credit"
          accent="negative"
          accounts={accountSections.revolvingRows}
          subtotal={accountSections.revolvingSubtotal}
          emptyLabel="No revolving credit accounts"
          displayCurrency={displayCurrency}
          taxAdvantagedCategoryById={taxAdvantagedCategoryById}
          showCreditLimit
          loading={accountsLoading}
        />

        <AccountListSection
          title="Amortizing debt"
          accent="negative"
          accounts={accountSections.amortizingRows}
          subtotal={accountSections.amortizingSubtotal}
          emptyLabel="No amortizing debt accounts"
          displayCurrency={displayCurrency}
          taxAdvantagedCategoryById={taxAdvantagedCategoryById}
          loading={accountsLoading}
        />

        <ArchivedAccountsSection
          accounts={archivedRows}
          taxAdvantagedCategoryById={taxAdvantagedCategoryById}
          displayCurrency={displayCurrency}
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
