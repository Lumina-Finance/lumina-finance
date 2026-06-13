import { useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { Plus, Search } from 'lucide-react'
import type { AccountsOverview } from '@/api/accounts'
import { useCurrencies } from '@/api/currency'
import { useTaxAdvantagedCategories } from '@/api/taxAdvantagedCategories'
import SectionHeader from '@/settings/components/SectionHeader'
import SettingsCard from '@/settings/components/SettingsCard'
import CreateTaxAdvantagedCategoryModal from '@/settings/components/TaxAdvantaged/TaxAdvantagedCategoriesSection/CreateTaxAdvantagedCategoryModal'
import TaxAdvantagedCategoriesTable from '@/settings/components/TaxAdvantaged/TaxAdvantagedCategoriesSection/TaxAdvantagedCategoriesTable'
import TaxAdvantagedCategoryModal from '@/settings/components/TaxAdvantaged/TaxAdvantagedCategoriesSection/TaxAdvantagedCategoryModal'
import { useTaxAdvantagedCategoryList } from '@/settings/components/TaxAdvantaged/TaxAdvantagedCategoriesSection/hooks/useTaxAdvantagedCategoryList'

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
  const { data: plans = [], isLoading } = useTaxAdvantagedCategories()
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const [search, setSearch] = useState('')
  const openCategory = plans.find((plan) => plan.id === openCategoryId) ?? null
  const { currentYear, filteredPlans, linkedAccountCounts } = useTaxAdvantagedCategoryList({
    accounts,
    plans,
    search,
    userTimezone,
  })

  const openCreateModal = () => {
    setCreateModalKey((key) => key + 1)
    setShowCreateModal(true)
  }

  return (
    <section id="tax-advantaged-categories" className="scroll-mt-8">
      <SectionHeader
        title="Tax-Advantaged Categories"
        description="Create category-level limits before assigning accounts to them."
      />

      <SettingsCard>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--app-text-subtle)' }}
                aria-hidden
              />
              <input
                className="app-input pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search categories..."
                disabled={plans.length === 0}
              />
            </div>
            <button
              type="button"
              className="app-primary-button shrink-0"
              onClick={openCreateModal}
            >
              <Plus size={16} aria-hidden />
              Create category
            </button>
          </div>

          {isLoading ? null : plans.length === 0 ? (
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
              onSelect={setOpenCategoryId}
              plans={filteredPlans}
            />
          )}
        </div>
      </SettingsCard>

      <AnimatePresence>
        {showCreateModal && (
          <CreateTaxAdvantagedCategoryModal
            key={createModalKey}
            currencies={currencies}
            onClose={() => setShowCreateModal(false)}
            userBaseCurrency={userBaseCurrency}
          />
        )}
        {openCategory && (
          <TaxAdvantagedCategoryModal
            key={openCategory.id}
            accounts={accounts}
            currencies={currencies}
            plan={openCategory}
            onClose={() => setOpenCategoryId(null)}
          />
        )}
      </AnimatePresence>
    </section>
  )
}

