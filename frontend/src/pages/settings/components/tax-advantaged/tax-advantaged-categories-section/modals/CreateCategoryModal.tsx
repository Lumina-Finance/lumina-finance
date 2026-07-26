import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Landmark, X } from 'lucide-react'
import type { Currency } from '@/api/currency'
import type { TaxTreatment } from '@/api/tax-advantaged-categories'
import Dropdown from '@/components/dropdown/Dropdown'
import { useModalFieldFocus } from '@/components/modal/useModalFieldFocus'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { useCreateTaxAdvantagedCategoryForm } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/hooks/useCreateCategoryForm'
import {
  EASE,
  TAX_TREATMENT_OPTIONS,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/constants'
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
  const { panelRef, handleModalFieldKeyDown } = useModalFieldFocus()

  useBodyScrollLock(true)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return createPortal(
    <>
      <motion.div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        aria-hidden
      />

      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.25, ease: EASE }}
        onClick={onClose}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-tax-advantaged-category-title"
          className="app-modal-panel flex max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-2xl"
          style={{
            background: 'var(--app-bg)',
            border: '1px solid var(--app-border-strong)',
            boxShadow: 'var(--app-shadow-soft)',
          }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={handleModalFieldKeyDown}
        >
          <div
            className="hidden w-16 shrink-0 flex-col items-center justify-between py-6 sm:flex"
            style={{
              background: 'var(--app-button-primary-bg)',
              color: 'var(--app-button-primary-text)',
            }}
            aria-hidden
          >
            <Landmark size={20} strokeWidth={2} />
            <span className="rotate-180 text-xs font-semibold uppercase" style={{ writingMode: 'vertical-rl' }}>
              TAC
            </span>
          </div>

          <form onSubmit={handleCreatePlan} className="flex min-h-0 w-full flex-col" noValidate>
            <div
              className="shrink-0 pb-5 pl-4 pr-5 pt-6 sm:pt-7 min-[1050px]:px-8"
              style={{ borderBottom: '1px solid var(--app-border)' }}
            >
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                    Tax-advantaged category
                  </p>
                  <h3 id="create-tax-advantaged-category-title" className="font-serif text-3xl font-normal">
                    Create Category
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="app-icon-button shrink-0"
                  aria-label="Close"
                >
                  <X size={20} aria-hidden />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pb-3 pl-4 pr-5 pt-4 min-[1050px]:px-8">
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
                          placeholder="0"
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
            </div>

            <div
              className="grid shrink-0 grid-cols-2 gap-3 px-6 py-4 sm:flex sm:justify-end sm:px-8 min-[1050px]:py-5"
              style={{ borderTop: '1px solid var(--app-border)' }}
            >
              <button
                type="button"
                className="app-secondary-button w-full sm:w-auto"
                onClick={onClose}
                disabled={isCreating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${isCreating ? 'app-primary-button-loading justify-self-center sm:justify-self-auto' : 'w-full sm:w-40'}`}
                disabled={isCreating}
              >
                {isCreating ? <div className="app-spinner" aria-label="Creating" /> : 'Create Category'}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </>,
    document.body,
  )
}
