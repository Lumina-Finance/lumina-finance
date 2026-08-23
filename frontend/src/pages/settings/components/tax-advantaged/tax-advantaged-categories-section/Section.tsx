import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { AccountsOverview } from '@/api/accounts'
import LoadFailure from '@/components/errors/LoadFailure'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import LoadingRegion from '@/components/loading/Region'
import { useCurrencies } from '@/api/currency'
import { useTaxAdvantagedCategories } from '@/api/tax-advantaged-categories'
import SettingsSectionHeader from '@/pages/settings/components/SectionHeader'
import SettingsCard from '@/pages/settings/components/Card'
import { SETTINGS_LIST_LOADING_OVERLAY_CLASS } from '@/pages/settings/components/shared/constants'
import CreateTaxAdvantagedCategoryModal from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/modals/CreateCategoryModal'
import { useCurrencyGuard } from '@/hooks/useCurrencyGuard'
import TaxAdvantagedCategoriesTable from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/table/CategoriesTable'
import TaxAdvantagedCategoryModal from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/modals/CategoryModal'
import { useTaxAdvantagedCategoryList } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/hooks/useCategoryList'

/**
 * Settings section for managing tax-advantaged categories, combining search, creation and a
 * table of categories that opens the detail modal when a row is selected
 */
export default function TaxAdvantagedCategoriesSection({
  accounts,
  userBaseCurrency,
  userTimezone,
}: {
  accounts: AccountsOverview[]
  userBaseCurrency?: string
  userTimezone?: string
}) {
  const { data: currencies = [] } = useCurrencies()
  const { data: plans = [], isLoading, isError, error } = useTaxAdvantagedCategories()
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null)
  // Held apart from the selection so the panel keeps its contents while it animates out
  const [isCategoryOpen, setIsCategoryOpen] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const requireCurrencies = useCurrencyGuard()
  const [createModalKey, setCreateModalKey] = useState(0)
  const [search, setSearch] = useState('')

  /**
   * Opens a category's details, recording the selection and the open state together
   */
  const openCategoryDetails = (categoryId: string) => {
    setOpenCategoryId(categoryId)
    setIsCategoryOpen(true)
  }
  const openCategory = plans.find((plan) => plan.id === openCategoryId) ?? null
  const { currentYear, filteredPlans, linkedAccountCounts } = useTaxAdvantagedCategoryList({
    accounts,
    plans,
    search,
    userTimezone,
  })

  const openCreateModal = () => {
    requireCurrencies(() => {
      setCreateModalKey((key) => key + 1)
      setShowCreateModal(true)
    })
  }

  return (
    <section id="tax-advantaged-categories" className="scroll-mt-8">
      <SettingsSectionHeader
        title="Tax-Advantaged Categories"
        description="Create category-level limits before assigning accounts to them."
      />

      <SettingsCard>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <GlassSearchField
              value={search}
              onValueChange={setSearch}
              placeholder="Search categories..."
              wrapperClassName="flex-1"
              disabled={plans.length === 0}
            />
            <button
              type="button"
              className="app-primary-button shrink-0"
              onClick={openCreateModal}
            >
              <Plus size={16} aria-hidden />
              Create category
            </button>
          </div>

          {/* The failure sits inside the region, so a first load that fails reveals its reason as
              the spinner leaves rather than putting a message beside a spinner still running. A
              refresh that fails over cached rows never conceals, so that message still lands at once */}
          <LoadingRegion
            loading={isLoading}
            label="Loading tax-advantaged categories"
            overlayClassName={SETTINGS_LIST_LOADING_OVERLAY_CLASS}
            animateLoadingHeight
          >
            {/* Cached categories from an earlier session survive a failed request, since the query
                cache is persisted, so the message sits above them rather than throwing a readable
                list away */}
            {isError && <LoadFailure error={error} subject="Tax-advantaged categories" />}

            {isError && plans.length === 0 ? null : plans.length === 0 ? (
              <p className="py-3 text-center italic text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                No tax-advantaged categories yet.
              </p>
            ) : filteredPlans.length === 0 ? (
              <p className="py-3 text-center italic text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                No categories match your search.
              </p>
            ) : (
              <TaxAdvantagedCategoriesTable
                currentYear={currentYear}
                linkedAccountCounts={linkedAccountCounts}
                onSelect={openCategoryDetails}
                plans={filteredPlans}
              />
            )}
          </LoadingRegion>
        </div>
      </SettingsCard>

      <CreateTaxAdvantagedCategoryModal
        key={createModalKey}
        open={showCreateModal}
        currencies={currencies}
        onClose={() => setShowCreateModal(false)}
        userBaseCurrency={userBaseCurrency}
      />

      {/* Held on its own state rather than derived from the selection, so the panel keeps its category while
          it animates out after the selection has already gone */}
      {openCategory && (
        <TaxAdvantagedCategoryModal
          key={openCategory.id}
          open={isCategoryOpen}
          accounts={accounts}
          currencies={currencies}
          plan={openCategory}
          onClose={() => setIsCategoryOpen(false)}
          onExitComplete={() => setOpenCategoryId(null)}
        />
      )}
    </section>
  )
}

