import { useMemo, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { getRegroupTransition } from '@/pages/accounts/components/regroupMotion'
import { useAuth } from '@/hooks/useAuth'
import { useAccounts, type AccountsOverview } from '@/api/accounts'
import { useTaxAdvantagedCategories } from '@/api/tax-advantaged-categories'
import CreateAccountModal from '@/pages/accounts/components/create-account-modal/Modal'
import NewAccountPromptModal from '@/pages/accounts/components/new-account-prompt/Modal'
import { useCurrencyGuard } from '@/hooks/useCurrencyGuard'
import AccountListToolbar from '@/pages/accounts/components/toolbar/ListToolbar'
import AccountListSection from '@/pages/accounts/components/ListSection'
import SummaryStatement from '@/pages/accounts/components/summary/Statement'
import MetricsBand from '@/pages/accounts/components/metrics/Band'
import ArchivedAccountsSection from '@/pages/accounts/components/ArchivedSection'
import TaxAdvantagedLimitsSection from '@/pages/accounts/components/tax-advantaged-limits/Section'
import { useFilters } from '@/pages/accounts/hooks/useFilters'
import { useAccountGrouping } from '@/pages/accounts/hooks/useAccountGrouping'
import { useAccountSections } from '@/pages/accounts/hooks/useAccountSections'
import { getAccountGroups } from '@/pages/accounts/utils/accountGroups'
import { useAccountsMetrics } from '@/pages/accounts/hooks/useAccountsMetrics'
import { useTaxAdvantagedLimitSummaries } from '@/pages/accounts/hooks/useTaxAdvantagedLimitSummaries'
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag'
import { LOADING_ANIMATION_MIN_MS } from '@/utils/timing'

/**
 * Accounts overview page listing every unarchived account grouped by the user's saved choice, account
 * type by default, alongside net worth, contribution limit summaries and archived accounts
 *
 * Archived accounts are held out of the grouped lists, the totals and the filter toolbar, and
 * appear only in their own section. The create-account modal is remounted each time it opens so
 * it always starts from an empty form, and an account it saves is followed by a prompt asking how it
 * stays up to date once the modal has finished closing
 */
export default function AccountsPage() {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const requireCurrencies = useCurrencyGuard()
  const [createModalKey, setCreateModalKey] = useState(0)
  // Where the toolbar ends once it sticks, which is where an open group's header sticks as its rows scroll
  // past. The toolbar measures it, and this guess holds until then
  const [groupHeaderStickyTop, setGroupHeaderStickyTop] = useState(72)
  const [createdAccount, setCreatedAccount] = useState<AccountsOverview | null>(null)
  const [showNewAccountPrompt, setShowNewAccountPrompt] = useState(false)
  const { user } = useAuth()
  const { data: accounts, isFetching, error } = useAccounts()
  const {
    data: taxAdvantagedCategories,
    error: taxAdvantagedCategoriesError,
    isError: taxAdvantagedCategoriesFailed,
  } = useTaxAdvantagedCategories()

  const allRows = useMemo(() => accounts ?? [], [accounts])

  // A fetch that already has rows to show leaves them in place, so adding an account no longer
  // drops the whole list through its exit animation and plays it back in. A fetch with nothing to
  // show still gets the spinner, which covers first load and the retry after a failed one alike
  const accountsLoading = useMinimumVisibleFlag(isFetching && allRows.length === 0, LOADING_ANIMATION_MIN_MS)
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
  const {
    grouping,
    setGrouping,
    thenBy,
    setThenBy,
    showLogos,
    setShowLogos,
    keepExpanded,
    setKeepExpanded,
    toggledGroupKeys,
    toggleGroup,
  } = useAccountGrouping()
  const groupingSettings = {
    grouping,
    onGroupingChange: setGrouping,
    thenBy,
    onThenByChange: setThenBy,
    showLogos,
    onShowLogosChange: setShowLogos,
    keepExpanded,
    onKeepExpandedChange: setKeepExpanded,
  }
  const regroupTransition = getRegroupTransition(useReducedMotion())
  const accountSections = useAccountSections(rows)
  const accountGroups = useMemo(
    () => getAccountGroups({ rows, filteredRows, grouping, thenBy }),
    [filteredRows, grouping, rows, thenBy],
  )
  const accountMetrics = useAccountsMetrics(rows, displayCurrency)
  const { taxAdvantagedCategoryById, taxAdvantagedLimitSummaries } = useTaxAdvantagedLimitSummaries({
    rows,
    taxAdvantagedCategories,
  })

  return (
    <div>
      <header className="app-page-header">
        <h1 className="app-page-title">My accounts</h1>
        <p className="app-page-description">
          Review balances, account groups, contribution limits, and archived accounts in one place.
        </p>
      </header>

      <div className="space-y-4">
        <SummaryStatement
          error={accountsLoading ? null : error}
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
          {/* The limits are built from the same accounts the statement above reports on, so a failed
              accounts request already says so there and a second message here would report one
              outage twice in two voices */}
          <TaxAdvantagedLimitsSection
            categoriesError={taxAdvantagedCategoriesError}
            categoriesFailed={taxAdvantagedCategoriesFailed && !error}
            summaries={taxAdvantagedLimitSummaries}
          />
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
        grouping={groupingSettings}
        onStickyOffsetChange={setGroupHeaderStickyTop}
        onAddAccount={() =>
          requireCurrencies(() => {
            setCreateModalKey((key) => key + 1)
            setShowCreateModal(true)
          })
        }
      />

      <div className="space-y-4">
        {/* Changing the grouping fades the old headers out and the new ones in, while the rows that stay
            glide between their places. The exiting headers leave the flow at once, so the list settles
            at its new height straight away and what sits below it glides there */}
        <LayoutGroup>
          <div className="relative">
            <AnimatePresence initial={false} mode="popLayout">
              {accountGroups.map((group) => (
                <motion.div
                  key={`${grouping}:${group.id}`}
                  // A little more room above each top-level divider than a sub-group has
                  className="mt-2 border-t first:mt-0 first:border-t-0"
                  style={{ borderColor: 'var(--app-border)' }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={regroupTransition}
                >
                  <AccountListSection
                    group={group}
                    grouping={grouping}
                    thenBy={thenBy}
                    toggledKeys={toggledGroupKeys}
                    keepExpanded={keepExpanded}
                    onToggle={toggleGroup}
                    showLogos={showLogos}
                    displayCurrency={displayCurrency}
                    taxAdvantagedCategoryById={taxAdvantagedCategoryById}
                    loading={accountsLoading}
                    stickyTop={groupHeaderStickyTop}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <motion.div layout="position" transition={regroupTransition}>
            <ArchivedAccountsSection
              accounts={archivedRows}
              taxAdvantagedCategoryById={taxAdvantagedCategoryById}
              displayCurrency={displayCurrency}
            />
          </motion.div>
        </LayoutGroup>
      </div>

      <CreateAccountModal
        key={createModalKey}
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={setCreatedAccount}
        onExitComplete={() => {
          if (createdAccount) setShowNewAccountPrompt(true)
        }}
      />

      {createdAccount && (
        <NewAccountPromptModal
          key={createdAccount.id}
          open={showNewAccountPrompt}
          account={createdAccount}
          onClose={() => setShowNewAccountPrompt(false)}
          onExitComplete={() => setCreatedAccount(null)}
        />
      )}
    </div>
  )
}
