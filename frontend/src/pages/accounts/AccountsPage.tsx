import { useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useAccounts } from '@/api/accounts'
import { useTaxAdvantagedCategories } from '@/api/tax-advantaged-categories'
import CreateAccountModal from '@/pages/accounts/components/create-account-modal/Modal'
import { useCurrencyGuard } from '@/hooks/useCurrencyGuard'
import AccountListToolbar from '@/pages/accounts/components/toolbar/ListToolbar'
import AccountListSection from '@/pages/accounts/components/ListSection'
import SummaryStatement from '@/pages/accounts/components/summary/Statement'
import MetricsBand from '@/pages/accounts/components/metrics/Band'
import ArchivedAccountsSection from '@/pages/accounts/components/ArchivedSection'
import TaxAdvantagedLimitsSection from '@/pages/accounts/components/tax-advantaged-limits/Section'
import { useFilters } from '@/pages/accounts/hooks/useFilters'
import { useAccountSections } from '@/pages/accounts/hooks/useAccountSections'
import { useAccountsMetrics } from '@/pages/accounts/hooks/useAccountsMetrics'
import { useTaxAdvantagedLimitSummaries } from '@/pages/accounts/hooks/useTaxAdvantagedLimitSummaries'

/**
 * Accounts overview page listing every open account grouped into assets, revolving credit and
 * amortizing debt, alongside net worth, contribution limit summaries and archived accounts
 *
 * Archived accounts are held out of the grouped lists, the totals and the filter toolbar, and
 * appear only in their own section. The create-account modal is remounted each time it opens so
 * it always starts from an empty form
 */
export default function AccountsPage() {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const requireCurrencies = useCurrencyGuard()
  const [createModalKey, setCreateModalKey] = useState(0)
  const { user } = useAuth()
  const { data: accounts, isFetching, error } = useAccounts()
  const { data: taxAdvantagedCategories } = useTaxAdvantagedCategories()

  const allRows = useMemo(() => accounts ?? [], [accounts])

  // A fetch that already has rows to show leaves them in place, so adding an account no longer
  // drops the whole list through its exit animation and plays it back in. A fetch with nothing to
  // show still gets the spinner, which covers first load and the retry after a failed one alike
  const accountsLoading = isFetching && allRows.length === 0
  const rows = useMemo(() => allRows.filter((account) => !account.is_archived), [allRows])
  const archivedRows = useMemo(() => allRows.filter((account) => account.is_archived), [allRows])
  const displayCurrency = user!.base_currency

  const {
    filters,
    setFilter,
    search,
    setSearch,
    activeFilterCount,
    institutionOptions,
    kindOptions,
    typeOptions,
    filteredRows,
  } = useFilters(rows)
  const accountSections = useAccountSections({ rows, filteredRows })
  const accountMetrics = useAccountsMetrics(rows, displayCurrency)
  const { taxAdvantagedCategoryById, taxAdvantagedLimitSummaries } =
    useTaxAdvantagedLimitSummaries({
      rows,
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
        <SummaryStatement
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
          <MetricsBand metrics={accountMetrics} displayCurrency={displayCurrency} />
          <TaxAdvantagedLimitsSection summaries={taxAdvantagedLimitSummaries} />
        </div>
      </div>

      {/* The toolbar sits outside the surrounding space-y groups so its own
          sticky margins set its top and bottom spacing, matching the transactions
          toolbar instead of inheriting the page group's larger gaps */}
      <AccountListToolbar
        search={search}
        onSearchChange={setSearch}
        filters={filters}
        setFilter={setFilter}
        activeFilterCount={activeFilterCount}
        institutionOptions={institutionOptions}
        kindOptions={kindOptions}
        typeOptions={typeOptions}
        onAddAccount={() => requireCurrencies(() => {
          setCreateModalKey((key) => key + 1)
          setShowCreateModal(true)
        })}
      />

      <div className="space-y-4">
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
