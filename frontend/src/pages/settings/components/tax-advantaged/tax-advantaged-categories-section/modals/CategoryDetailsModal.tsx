import { ArrowLeftRight, Pencil, X } from 'lucide-react'
import { ModalShell } from '@/components/modal/Shell'
import type { Currency } from '@/api/currency'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import ActionFeedbackButton from '@/components/feedback/ActionButton'
import Dropdown from '@/components/dropdown/Dropdown'
import type { TaxPlanFormState } from '@/pages/settings/components/tax-advantaged/types'
import { TAX_TREATMENT_OPTIONS } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/constants'
import {
  CompactCurrencyInput,
  TaxAdvantagedCurrencyWarning,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/controls/FormControls'
import TaxAdvantagedOpeningUsageLabel from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/controls/OpeningUsageLabel'

const COUNTS_INTERNAL_TRANSFERS_FIELD_ID = 'tac-details-counts-internal-transfers'

interface TaxAdvantagedCategoryDetailsModalProps {
  currencies: Currency[]
  onClose: () => void
  onPlanFieldChange: <K extends keyof TaxPlanFormState>(key: K, value: TaxPlanFormState[K]) => void
  onSave: () => void
  open: boolean
  plan: TaxAdvantagedCategory
  planError: string | null
  planForm: TaxPlanFormState
  planSaveStatus: 'idle' | 'loading' | 'success'
  updatePending: boolean
}

/**
 * Renders the TAC identity and lifetime room edit dialog
 */
export default function TaxAdvantagedCategoryDetailsModal({
  currencies,
  onClose,
  onPlanFieldChange,
  onSave,
  open,
  plan,
  planError,
  planForm,
  planSaveStatus,
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
      <div className="flex shrink-0 items-start justify-between gap-4 border-b p-5" style={{ borderColor: 'var(--app-border)' }}>
        <div className="min-w-0">
          <h4 id="tax-category-details-title" className="font-serif text-2xl font-medium tracking-tight">
            TAC Details
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
          aria-label="Close TAC details"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      {/* The stylesheet pins every modal panel to the full viewport height below 1050px, so the body
          has to keep scrolling until that rule stops applying. Letting it overflow visible any earlier
          puts content past the bottom of a fixed-height panel with no way to reach it */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-5 min-[1050px]:overflow-visible">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 min-[620px]:grid-cols-[minmax(0,3fr)_minmax(0,7fr)]">
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <div className="min-w-0">
                <span className="app-label mb-0.5 block text-xs">Scope</span>
                <span className="block h-8 truncate text-[0.9375rem] font-medium leading-8">
                  {plan.group_id ? 'Group' : 'Personal'}
                </span>
              </div>
              <div className="min-w-0">
                <span className="app-label mb-0.5 block text-xs">Currency</span>
                <span className="inline-flex h-8 min-w-0 items-center gap-1 text-[0.9375rem] font-medium">
                  <span className="truncate">{plan.currency}</span>
                  <TaxAdvantagedCurrencyWarning />
                </span>
              </div>
            </div>
            <div className="min-w-0">
              <span className="app-label mb-0.5 block text-xs">Name</span>
              <div
                className="group flex h-8 w-full items-center gap-1.5 rounded-md border border-transparent px-2 transition-colors duration-150 hover:border-[var(--app-border)] focus-within:border-[var(--app-accent-border)]"
                style={{ background: 'color-mix(in srgb, var(--app-input-bg) 55%, var(--app-bg))' }}
              >
                <input
                  aria-label="TAC name"
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
                  className="shrink-0 opacity-45 transition-opacity duration-150 group-hover:opacity-70 group-focus-within:opacity-80"
                  style={{ color: 'var(--app-text-subtle)' }}
                  aria-hidden
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 min-[620px]:grid-cols-[minmax(0,3fr)_minmax(0,7fr)]">
            <div className="min-w-0">
              <span className="app-label mb-1 block text-xs">Type</span>
              <Dropdown
                className="h-9 w-full rounded-md border border-transparent bg-[color-mix(in_srgb,var(--app-input-bg)_55%,var(--app-bg))] px-2 py-0 text-[0.9375rem] font-medium outline-none transition-colors duration-150 hover:border-[var(--app-border)] focus:border-[var(--app-accent-border)]"
                options={TAX_TREATMENT_OPTIONS}
                value={planForm.tax_treatment}
                onChange={(value) => onPlanFieldChange('tax_treatment', value as TaxPlanFormState['tax_treatment'])}
              />
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-3 min-[620px]:grid-cols-2">
              <div className="min-w-0">
                <span className="app-label mb-1 block text-xs">Lifetime limit</span>
                <CompactCurrencyInput
                  ariaLabel="Lifetime limit"
                  currencies={currencies}
                  currency={plan.currency}
                  value={planForm.lifetime_contribution_limit}
                  onChange={(value) => onPlanFieldChange('lifetime_contribution_limit', value)}
                  placeholder="Optional"
                />
              </div>
              <div className="min-w-0">
                <span className="app-label mb-1 block text-xs">
                  <TaxAdvantagedOpeningUsageLabel />
                </span>
                <CompactCurrencyInput
                  ariaLabel="Opening usage"
                  currencies={currencies}
                  currency={plan.currency}
                  value={planForm.accrued_contributions}
                  onChange={(value) => onPlanFieldChange('accrued_contributions', value)}
                />
              </div>
            </div>
          </div>

          <label
            htmlFor={COUNTS_INTERNAL_TRANSFERS_FIELD_ID}
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
            <span className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors">
              <input
                id={COUNTS_INTERNAL_TRANSFERS_FIELD_ID}
                type="checkbox"
                role="switch"
                checked={planForm.counts_internal_transfers}
                onChange={(event) => onPlanFieldChange('counts_internal_transfers', event.target.checked)}
                className="peer sr-only"
              />
              <span
                className="absolute inset-0 rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"
                style={{ background: planForm.counts_internal_transfers ? 'var(--app-accent)' : 'var(--app-border-strong)' }}
                aria-hidden
              />
              <span
                className="relative h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                style={{ transform: planForm.counts_internal_transfers ? 'translateX(1.25rem)' : 'translateX(0)' }}
                aria-hidden
              />
            </span>
          </label>

          {planError && (
            <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
              {planError}
            </p>
          )}
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
