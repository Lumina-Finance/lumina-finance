import { ArrowLeftRight, Landmark } from 'lucide-react'
import { Switch } from '@/components/forms/Switch'
import type { Currency } from '@/api/currency'
import type { TaxTreatment } from '@/api/tax-advantaged-categories'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import Dropdown from '@/components/dropdown/Dropdown'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { useCreateTaxAdvantagedCategoryForm } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/hooks/useCreateCategoryForm'
import { TAX_TREATMENT_OPTIONS } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/constants'
import {
  CREATE_CATEGORY_ERROR_IDS,
  CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/modalFieldIds'
import { getFieldLabelId } from '@/utils/fieldLabel'
import {
  CurrencyInput,
  TaxAdvantagedCurrencyWarning,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/controls/FormControls'

/**
 * Renders the modal for creating a new tax-advantaged category
 */
export default function CreateTaxAdvantagedCategoryModal({
  open,
  currencies,
  onClose,
  userBaseCurrency,
}: {
  open: boolean
  currencies: Currency[]
  onClose: () => void
  userBaseCurrency?: string
}) {
  const {
    blockedReason,
    createError,
    errors,
    form,
    handleCreatePlan,
    isCreating,
    options,
    selectedCurrency,
    setField,
  } = useCreateTaxAdvantagedCategoryForm({ currencies, onClose, userBaseCurrency })

  return (
    <ModalTitledPanel
      open={open}
      onClose={onClose}
      onSubmit={handleCreatePlan}
      titleId="create-tax-advantaged-category-title"
      title="Create category"
      eyebrow="Tax-advantaged category"
      RailIcon={Landmark}
      railLabel="TAC"
      widthClassName="max-w-3xl"
      closeDisabled={isCreating}
      footer={(
        <ModalFormFooter
          submitLabel="Create category"
          submitDisabled={isCreating}
          submitBlockedReason={blockedReason}
          submitWidthClassName="w-full sm:w-40"
          error={createError}
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
                <CreateModalFieldLabelRow
                  htmlFor={CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.name}
                  label="Category name"
                  error={errors.name}
                  errorId={CREATE_CATEGORY_ERROR_IDS.name}
                />
                <input
                  id={CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.name}
                  className={`app-input ${errors.name ? 'app-input-error' : ''}`}
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby={errors.name ? CREATE_CATEGORY_ERROR_IDS.name : undefined}
                  value={form.name}
                  onChange={(event) => setField('name', event.target.value)}
                  placeholder="TFSA"
                  maxLength={256}
                  required
                />
              </div>
              <div>
                <label htmlFor={CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.taxTreatment} className="app-label mb-1.5 block text-[0.9375rem] leading-5">Category type</label>
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
                <CreateModalFieldLabelRow
                  htmlFor={CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.currency}
                  label="Currency"
                  accessory={<TaxAdvantagedCurrencyWarning />}
                  error={errors.currency}
                  errorId={CREATE_CATEGORY_ERROR_IDS.currency}
                />
                <Dropdown
                  id={CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.currency}
                  options={options}
                  value={selectedCurrency}
                  onChange={(value) => setField('currency', value)}
                  hasError={!!errors.currency}
                  describedBy={errors.currency ? CREATE_CATEGORY_ERROR_IDS.currency : undefined}
                  labelledBy={getFieldLabelId(CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.currency)}
                  placeholder="Select currency"
                  searchable
                  searchPlaceholder="Search currencies..."
                />
              </div>
              <div>
                <CreateModalFieldLabelRow
                  htmlFor={CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.lifetimeContributionLimit}
                  label="Lifetime contribution limit"
                  error={errors.lifetimeContributionLimit}
                  errorId={CREATE_CATEGORY_ERROR_IDS.lifetimeContributionLimit}
                />
                <CurrencyInput
                  id={CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.lifetimeContributionLimit}
                  hasError={!!errors.lifetimeContributionLimit}
                  errorId={CREATE_CATEGORY_ERROR_IDS.lifetimeContributionLimit}
                  currencies={currencies}
                  currency={selectedCurrency}
                  value={form.lifetime_contribution_limit}
                  onChange={(value) => setField('lifetime_contribution_limit', value)}
                  placeholder="Optional"
                />
              </div>
              <div>
                <CreateModalFieldLabelRow
                  htmlFor={CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.accruedContributions}
                  label="Accrued contributions"
                  error={errors.accruedContributions}
                  errorId={CREATE_CATEGORY_ERROR_IDS.accruedContributions}
                />
                <CurrencyInput
                  id={CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.accruedContributions}
                  hasError={!!errors.accruedContributions}
                  errorId={CREATE_CATEGORY_ERROR_IDS.accruedContributions}
                  currencies={currencies}
                  currency={selectedCurrency}
                  value={form.accrued_contributions}
                  onChange={(value) => setField('accrued_contributions', value)}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 min-[1050px]:gap-x-3">
          <div className="flex min-h-0 flex-col items-center">
            <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
              03
            </span>
            <span
              className="mt-1 w-px flex-1"
              style={{ backgroundColor: 'var(--app-border-strong)' }}
              aria-hidden
            />
          </div>

          <div className="min-w-0 space-y-3">
            <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Transfers</p>
            <label
              htmlFor={CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.countsInternalTransfers}
              className="flex cursor-pointer items-center justify-between gap-4 rounded-xl p-4"
              style={{
                background: 'var(--app-input-bg)',
                border: '1px solid var(--app-input-border)',
              }}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-medium">
                  <ArrowLeftRight size={16} style={{ color: 'var(--app-text-muted)' }} aria-hidden />
                  Count transfers between this category's accounts
                </span>
                <span className="mt-0.5 block text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  Money moved between two accounts in the category counts toward its contribution and withdrawal limits.
                </span>
              </span>
              <Switch
                id={CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.countsInternalTransfers}
                checked={form.counts_internal_transfers}
                onChange={(checked) => setField('counts_internal_transfers', checked)}
              />
            </label>
          </div>
        </section>
      </div>
    </ModalTitledPanel>
  )
}
