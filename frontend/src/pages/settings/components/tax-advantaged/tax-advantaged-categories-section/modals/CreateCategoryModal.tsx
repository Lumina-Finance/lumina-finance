import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Landmark } from 'lucide-react'
import type { Currency } from '@/api/currency'
import type { TaxTreatment } from '@/api/tax-advantaged-categories'
import Dropdown from '@/components/dropdown/Dropdown'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { useCreateTaxAdvantagedCategoryForm } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/hooks/useCreateCategoryForm'
import { TAX_TREATMENT_OPTIONS } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/constants'
import { CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/modalFieldIds'
import {
  CurrencyInput,
  TaxAdvantagedCurrencyWarning,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/controls/FormControls'

/**
 * Renders the modal for creating a new tax-advantaged category
 */
export default function CreateTaxAdvantagedCategoryModal({
  currencies,
  onClose,
  userBaseCurrency,
}: {
  currencies: Currency[]
  onClose: () => void
  userBaseCurrency?: string
}) {
  const {
    createError,
    form,
    handleCreatePlan,
    isCreating,
    options,
    selectedCurrency,
    setField,
  } = useCreateTaxAdvantagedCategoryForm({ currencies, onClose, userBaseCurrency })


  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <ModalTitledPanel
      open
      onClose={onClose}
      onSubmit={handleCreatePlan}
      titleId="create-tax-advantaged-category-title"
      title="Create Category"
      eyebrow="Tax-advantaged category"
      RailIcon={Landmark}
      railLabel="TAC"
      widthClassName="max-w-3xl"
      closeDisabled={isCreating}
      footer={(
        <ModalFormFooter
          submitLabel="Create Category"
          submitDisabled={isCreating}
          submitWidthClassName="w-full sm:w-40"
          onCancel={onClose}
        />
      )}
    >
      <div className="space-y-5">
        <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 min-[1050px]:gap-x-3">
          <div className="flex min-h-0 flex-col items-center">
            <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
              01
            </span>
            <span
              className="mt-1 w-px flex-1"
              style={{ backgroundColor: 'var(--app-border-strong)' }}
              aria-hidden
            />
          </div>

          <div className="min-w-0 space-y-3">
            <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Identity</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className="app-label mb-1.5 block text-[0.9375rem] leading-5">Category name</span>
                <input
                  id={CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.name}
                  className="app-input"
                  value={form.name}
                  onChange={(event) => setField('name', event.target.value)}
                  placeholder="TFSA"
                  maxLength={256}
                  required
                />
              </div>
              <div>
                <span className="app-label mb-1.5 block text-[0.9375rem] leading-5">Category type</span>
                <Dropdown
                  id={CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.taxTreatment}
                  options={TAX_TREATMENT_OPTIONS}
                  value={form.tax_treatment}
                  onChange={(value) => setField('tax_treatment', value as TaxTreatment)}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 min-[1050px]:gap-x-3">
          <div className="flex min-h-0 flex-col items-center">
            <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
              02
            </span>
            <span
              className="mt-1 w-px flex-1"
              style={{ backgroundColor: 'var(--app-border-strong)' }}
              aria-hidden
            />
          </div>

          <div className="min-w-0 space-y-3">
            <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Limits</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="app-label block text-[0.9375rem] leading-5">Currency</span>
                  <TaxAdvantagedCurrencyWarning />
                </div>
                <Dropdown
                  id={CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.currency}
                  options={options}
                  value={selectedCurrency}
                  onChange={(value) => setField('currency', value)}
                  placeholder="Select currency"
                  searchable
                  searchPlaceholder="Search currencies..."
                />
              </div>
              <div>
                <span className="app-label mb-1.5 block text-[0.9375rem] leading-5">Lifetime Contribution Limit</span>
                <CurrencyInput
                  id={CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.lifetimeContributionLimit}
                  currencies={currencies}
                  currency={selectedCurrency}
                  value={form.lifetime_contribution_limit}
                  onChange={(value) => setField('lifetime_contribution_limit', value)}
                  placeholder="Optional"
                />
              </div>
              <div>
                <span className="app-label mb-1.5 block text-[0.9375rem] leading-5">Accrued Contributions</span>
                <CurrencyInput
                  id={CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.accruedContributions}
                  currencies={currencies}
                  currency={selectedCurrency}
                  value={form.accrued_contributions}
                  onChange={(value) => setField('accrued_contributions', value)}
                />
              </div>
            </div>
          </div>
        </section>

        <AnimatePresence>
          {createError && (
            <motion.p
              className="text-sm font-medium"
              style={{ color: 'var(--app-negative)' }}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              {createError}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </ModalTitledPanel>
  )
}
