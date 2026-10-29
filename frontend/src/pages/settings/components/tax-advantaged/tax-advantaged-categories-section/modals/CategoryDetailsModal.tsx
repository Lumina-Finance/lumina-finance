import { ArrowLeftRight, Pencil, X } from 'lucide-react'
import { Switch } from '@/components/forms/Switch'
import { ModalShell } from '@/components/modal/Shell'
import type { Currency } from '@/api/currency'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import ActionFeedbackButton from '@/components/feedback/ActionButton'
import Dropdown from '@/components/dropdown/Dropdown'
import { FieldLabelRow } from '@/components/forms/FieldLabelRow'
import { FormError } from '@/components/forms/FormError'
import type { TaxPlanFormState } from '@/pages/settings/components/tax-advantaged/types'
import { TAX_TREATMENT_OPTIONS } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/constants'
import {
  CompactCurrencyInput,
  TaxAdvantagedCurrencyWarning,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/controls/FormControls'
import { getCompactFieldFrameStyle } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/utils/compactFieldStyle'
import TaxAdvantagedOpeningUsageLabel from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/controls/OpeningUsageLabel'
import {
  CATEGORY_DETAILS_ERROR_IDS,
  CATEGORY_DETAILS_FIELD_IDS,
  type CategoryDetailsField,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/modalFieldIds'
import type { FieldProblems } from '@/utils/refusedSubmit'

interface TaxAdvantagedCategoryDetailsModalProps {
  /** Why Save is held off once a press found something missing or wrong, or nothing while it is not */
  blockedReason?: string
  currencies: Currency[]
  onClose: () => void
  onPlanFieldChange: <K extends keyof TaxPlanFormState>(key: K, value: TaxPlanFormState[K]) => void
  onSave: () => void
  open: boolean
  plan: TaxAdvantagedCategory
  planError: string | null
  planForm: TaxPlanFormState
  planSaveStatus: 'idle' | 'loading' | 'success'
  /** The fields marked as wrong right now */
  problems: FieldProblems<CategoryDetailsField>
  updatePending: boolean
}

/**
 * Renders the TAC identity and lifetime room edit dialog
 */
export default function TaxAdvantagedCategoryDetailsModal({
  blockedReason,
  currencies,
  onClose,
  onPlanFieldChange,
  onSave,
  open,
  plan,
  planError,
  planForm,
  planSaveStatus,
  problems,
  updatePending,
}: TaxAdvantagedCategoryDetailsModalProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      titleId="tax-category-details-title"
      panelClassName="flex max-h-[100dvh] min-h-[100dvh] w-full flex-col overflow-hidden rounded-none min-[620px]:min-h-0 min-[620px]:max-h-[calc(100dvh-2rem)] min-[620px]:max-w-[38rem] min-[620px]:rounded-2xl min-[1050px]:overflow-visible"
      level="stacked"
      boundsTooltips
    >
      <div
        className="flex shrink-0 items-start justify-between gap-4 border-b p-5"
        style={{ borderColor: 'var(--app-border)' }}
      >
        <div className="min-w-0">
          <h4 id="tax-category-details-title" className="font-serif text-2xl font-medium tracking-tight">
            Category details
          </h4>
          <p className="mt-1 text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Edit category identity and lifetime contribution room.
          </p>
        </div>
        <button
          type="button"
          className="app-icon-button shrink-0"
          onClick={onClose}
          disabled={updatePending || planSaveStatus !== 'idle'}
          aria-label="Close category details"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      {/* The stylesheet pins every modal panel to the full viewport height below 1050px, so the body
          has to keep scrolling until that rule stops applying. Letting it overflow visible any earlier
          puts content past the bottom of a fixed-height panel with no way to reach it */}
      <div
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-5 min-[1050px]:overflow-visible"
        data-dropdown-bounds
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 min-[620px]:grid-cols-[minmax(0,3fr)_minmax(0,7fr)]">
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <div className="min-w-0">
                <span className="app-label mb-0.5 block text-xs leading-5">Scope</span>
                <span className="block h-8 truncate text-[0.9375rem] font-medium leading-8">
                  {plan.group_id ? 'Group' : 'Personal'}
                </span>
              </div>
              <div className="min-w-0">
                <span className="app-label mb-0.5 block text-xs leading-5">Currency</span>
                <span className="inline-flex h-8 min-w-0 items-center gap-1 text-[0.9375rem] font-medium">
                  <span className="truncate">{plan.currency}</span>
                  <TaxAdvantagedCurrencyWarning />
                </span>
              </div>
            </div>
            <div className="min-w-0">
              <FieldLabelRow
                compact
                htmlFor={CATEGORY_DETAILS_FIELD_IDS.name}
                label="Name"
                error={problems.name}
                errorId={CATEGORY_DETAILS_ERROR_IDS.name}
                spacingClassName="mb-0.5"
              />
              <div
                className="group flex h-8 w-full items-center gap-1.5 rounded-md border border-transparent px-2 transition-colors hover:border-[var(--app-border)] app-field-focus"
                style={getCompactFieldFrameStyle(!!problems.name)}
              >
                <input
                  aria-label="Category name"
                  aria-describedby={problems.name ? CATEGORY_DETAILS_ERROR_IDS.name : undefined}
                  aria-invalid={problems.name ? true : undefined}
                  id={CATEGORY_DETAILS_FIELD_IDS.name}
                  className="block h-7 min-w-0 flex-1 bg-transparent text-[0.9375rem] font-medium leading-7 outline-none"
                  maxLength={256}
                  onChange={(event) => onPlanFieldChange('name', event.target.value)}
                  required
                  style={{ color: 'var(--app-text)' }}
                  type="text"
                  value={planForm.name}
                />
                <Pencil
                  size={13}
                  className="shrink-0 opacity-45 transition-opacity group-hover:opacity-70 group-focus-within:opacity-80"
                  style={{ color: 'var(--app-text-subtle)' }}
                  aria-hidden
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 min-[620px]:grid-cols-[minmax(0,3fr)_minmax(0,7fr)]">
            <div className="min-w-0">
              <label htmlFor={CATEGORY_DETAILS_FIELD_IDS.taxTreatment} className="app-label mb-1 block text-xs">
                Type
              </label>
              <Dropdown
                id={CATEGORY_DETAILS_FIELD_IDS.taxTreatment}
                className="w-full"
                size="compact"
                options={TAX_TREATMENT_OPTIONS}
                value={planForm.tax_treatment}
                onChange={(value) => onPlanFieldChange('tax_treatment', value as TaxPlanFormState['tax_treatment'])}
              />
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-3 min-[620px]:grid-cols-2">
              <div className="min-w-0">
                <FieldLabelRow
                  compact
                  htmlFor={CATEGORY_DETAILS_FIELD_IDS.lifetimeLimit}
                  label="Lifetime limit"
                  error={problems.lifetimeLimit}
                  errorId={CATEGORY_DETAILS_ERROR_IDS.lifetimeLimit}
                  spacingClassName="mb-1"
                />
                <CompactCurrencyInput
                  ariaLabel="Lifetime limit"
                  hasError={!!problems.lifetimeLimit}
                  errorId={CATEGORY_DETAILS_ERROR_IDS.lifetimeLimit}
                  id={CATEGORY_DETAILS_FIELD_IDS.lifetimeLimit}
                  currencies={currencies}
                  currency={plan.currency}
                  value={planForm.lifetime_contribution_limit}
                  onChange={(value) => onPlanFieldChange('lifetime_contribution_limit', value)}
                  placeholder="Optional"
                />
              </div>
              <div className="min-w-0">
                <FieldLabelRow
                  compact
                  htmlFor={CATEGORY_DETAILS_FIELD_IDS.openingUsage}
                  label={<TaxAdvantagedOpeningUsageLabel />}
                  error={problems.openingUsage}
                  errorId={CATEGORY_DETAILS_ERROR_IDS.openingUsage}
                  spacingClassName="mb-1"
                />
                <CompactCurrencyInput
                  ariaLabel="Opening usage"
                  hasError={!!problems.openingUsage}
                  errorId={CATEGORY_DETAILS_ERROR_IDS.openingUsage}
                  id={CATEGORY_DETAILS_FIELD_IDS.openingUsage}
                  currencies={currencies}
                  currency={plan.currency}
                  value={planForm.accrued_contributions}
                  onChange={(value) => onPlanFieldChange('accrued_contributions', value)}
                />
              </div>
            </div>
          </div>

          <label
            htmlFor={CATEGORY_DETAILS_FIELD_IDS.countsInternalTransfers}
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
              id={CATEGORY_DETAILS_FIELD_IDS.countsInternalTransfers}
              checked={planForm.counts_internal_transfers}
              onChange={(checked) => onPlanFieldChange('counts_internal_transfers', checked)}
            />
          </label>

          <FormError message={planError} />
        </div>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t px-5 py-4" style={{ borderColor: 'var(--app-border)' }}>
        <button
          type="button"
          className="app-secondary-button justify-center"
          onClick={onClose}
          disabled={updatePending || planSaveStatus !== 'idle'}
        >
          Cancel
        </button>
        <ActionFeedbackButton
          type="button"
          className="app-primary-button justify-center"
          disabled={planSaveStatus !== 'idle'}
          disabledReason={planSaveStatus === 'idle' ? blockedReason : undefined}
          loadingLabel="Saving"
          onClick={onSave}
          status={planSaveStatus}
        >
          Save
        </ActionFeedbackButton>
      </div>
    </ModalShell>
  )
}
