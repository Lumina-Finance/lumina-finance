import { Pencil, Trash2, X } from 'lucide-react'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { ModalShell } from '@/components/modal/Shell'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import type { Currency } from '@/api/currency'
import type { TaxAdvantagedCategory, TaxAdvantagedCategoryLimit } from '@/api/tax-advantaged-categories'
import type {
  TaxPlanLimitDraftField,
  TaxPlanLimitDraftState,
  TaxPlanLimitFormState,
} from '@/pages/settings/components/tax-advantaged/types'
import { FieldLabelRow } from '@/components/forms/FieldLabelRow'
import { FormError } from '@/components/forms/FormError'
import { CompactCurrencyInput } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/controls/FormControls'
import { getCompactFieldFrameStyle } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/utils/compactFieldStyle'
import {
  EXISTING_LIMIT_CONTROL_IDS,
  NEW_LIMIT_CONTROL_IDS,
  type LimitField,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/modalFieldIds'
import type { FieldProblems } from '@/utils/refusedSubmit'

interface TaxAdvantagedLimitDetailsModalProps {
  /** Why Save is held off once a press found something missing or wrong, or nothing while it is not */
  blockedReason?: string
  creatingLimit: boolean
  currencies: Currency[]
  limitError: string | null
  newLimitForm: TaxPlanLimitFormState
  onClose: () => void
  onCreateLimit: () => void
  onDeleteLimit: (limit: TaxAdvantagedCategoryLimit) => void
  onLimitFieldChange: (year: number, key: TaxPlanLimitDraftField, value: string) => void
  onNewLimitFieldChange: <K extends keyof TaxPlanLimitFormState>(key: K, value: TaxPlanLimitFormState[K]) => void
  onSaveLimit: (year: number) => void
  plan: TaxAdvantagedCategory
  /** The fields marked as wrong right now */
  problems: FieldProblems<LimitField>
  selectedLimit: TaxAdvantagedCategoryLimit | null
  selectedLimitDeleteConfirming: boolean
  selectedLimitDeleting: boolean
  selectedSavingLimit: boolean
  selectedDraft: TaxPlanLimitDraftState | null
  showAddTaxYear: boolean
}

const getLimitErrorId = (controlId: string) => `${controlId}-error`

/**
 * Renders the add and edit dialogs for annual TAC limits
 */
export default function TaxAdvantagedLimitDetailsModal({
  blockedReason,
  creatingLimit,
  currencies,
  limitError,
  newLimitForm,
  onClose,
  onCreateLimit,
  onDeleteLimit,
  onLimitFieldChange,
  onNewLimitFieldChange,
  onSaveLimit,
  plan,
  problems,
  selectedLimit,
  selectedLimitDeleteConfirming,
  selectedLimitDeleting,
  selectedSavingLimit,
  selectedDraft,
  showAddTaxYear,
}: TaxAdvantagedLimitDetailsModalProps) {
  return (
    <ModalShell
      open={showAddTaxYear || Boolean(selectedLimit && selectedDraft)}
      onClose={onClose}
      titleId="tax-year-limit-title"
      panelClassName="flex max-h-[100dvh] min-h-[100dvh] w-full flex-col overflow-hidden rounded-none min-[620px]:min-h-0 min-[620px]:max-h-[calc(100dvh-2rem)] min-[620px]:max-w-[38rem] min-[620px]:rounded-2xl"
      level="stacked"
      boundsTooltips
    >
      <div
        className="flex shrink-0 items-start justify-between gap-4 border-b p-5"
        style={{ borderColor: 'var(--app-border)' }}
      >
        <div className="min-w-0">
          <h4 id="tax-year-limit-title" className="font-serif text-2xl font-medium tracking-tight">
            {showAddTaxYear ? 'New year' : selectedLimit?.year}
          </h4>
          <p className="mt-1 text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {showAddTaxYear ? 'Configure annual limits and opening usage.' : 'Edit annual limits and opening usage.'}
          </p>
        </div>
        <button
          type="button"
          className="app-icon-button shrink-0"
          onClick={onClose}
          disabled={creatingLimit || selectedSavingLimit}
          aria-label="Close tax year details"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {showAddTaxYear ? (
          <div className="space-y-4">
            <div>
              <FieldLabelRow
                compact
                htmlFor={NEW_LIMIT_CONTROL_IDS.year}
                label="Year"
                error={problems.year}
                errorId={getLimitErrorId(NEW_LIMIT_CONTROL_IDS.year)}
                spacingClassName="mb-1"
              />
              <div
                className="group flex h-9 w-full items-center gap-1.5 rounded-md border border-transparent px-2 transition-colors hover:border-[var(--app-border)] app-field-focus"
                style={getCompactFieldFrameStyle(!!problems.year)}
              >
                <input
                  aria-label="New tax year"
                  aria-describedby={problems.year ? getLimitErrorId(NEW_LIMIT_CONTROL_IDS.year) : undefined}
                  aria-invalid={problems.year ? true : undefined}
                  id={NEW_LIMIT_CONTROL_IDS.year}
                  className="block h-8 min-w-0 flex-1 bg-transparent text-[0.9375rem] font-medium leading-8 outline-none"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  type="text"
                  value={newLimitForm.year}
                  onChange={(event) => onNewLimitFieldChange('year', event.target.value.replace(/\D/g, '').slice(0, 4))}
                  style={{ color: 'var(--app-text)' }}
                />
                <Pencil
                  size={13}
                  className="shrink-0 opacity-45 transition-opacity group-hover:opacity-70 group-focus-within:opacity-80"
                  style={{ color: 'var(--app-text-subtle)' }}
                  aria-hidden
                />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Contribution</p>
              <div className="grid grid-cols-2 gap-3">
                {renderNewLimitEditorField(
                  'contribution_limit',
                  'Limit',
                  'New tax-year contribution limit',
                  currencies,
                  plan,
                  newLimitForm,
                  problems,
                  onNewLimitFieldChange,
                  'Required',
                )}
                {renderNewLimitEditorField(
                  'accrued_contributions',
                  'Opening',
                  'New tax-year opening contributions',
                  currencies,
                  plan,
                  newLimitForm,
                  problems,
                  onNewLimitFieldChange,
                )}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Withdrawal</p>
              <div className="grid grid-cols-2 gap-3">
                {renderNewLimitEditorField(
                  'withdrawal_limit',
                  'Limit',
                  'New tax-year withdrawal limit',
                  currencies,
                  plan,
                  newLimitForm,
                  problems,
                  onNewLimitFieldChange,
                  'Optional',
                )}
                {renderNewLimitEditorField(
                  'accrued_withdrawals',
                  'Opening',
                  'New tax-year opening withdrawals',
                  currencies,
                  plan,
                  newLimitForm,
                  problems,
                  onNewLimitFieldChange,
                )}
              </div>
            </div>
            <FormError message={limitError} />
          </div>
        ) : selectedLimit && selectedDraft ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Contribution</p>
              <div className="grid grid-cols-2 gap-3">
                {renderLimitEditorField(
                  selectedLimit.year,
                  'contribution_limit',
                  'Limit',
                  'Contribution limit',
                  selectedDraft.contribution_limit,
                  currencies,
                  plan,
                  problems,
                  onLimitFieldChange,
                  'Required',
                )}
                {renderLimitEditorField(
                  selectedLimit.year,
                  'accrued_contributions',
                  'Opening',
                  'Opening contributions',
                  selectedDraft.accrued_contributions,
                  currencies,
                  plan,
                  problems,
                  onLimitFieldChange,
                )}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Withdrawal</p>
              <div className="grid grid-cols-2 gap-3">
                {renderLimitEditorField(
                  selectedLimit.year,
                  'withdrawal_limit',
                  'Limit',
                  'Withdrawal limit',
                  selectedDraft.withdrawal_limit,
                  currencies,
                  plan,
                  problems,
                  onLimitFieldChange,
                  'Optional',
                )}
                {renderLimitEditorField(
                  selectedLimit.year,
                  'accrued_withdrawals',
                  'Opening',
                  'Opening withdrawals',
                  selectedDraft.accrued_withdrawals,
                  currencies,
                  plan,
                  problems,
                  onLimitFieldChange,
                )}
              </div>
            </div>
            <FormError message={limitError} />
          </div>
        ) : null}
      </div>
      <div data-toast-keep-clear className="shrink-0 border-t px-5 py-4" style={{ borderColor: 'var(--app-border)' }}>
        {showAddTaxYear ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="app-secondary-button justify-center"
              onClick={onClose}
              disabled={creatingLimit}
            >
              Cancel
            </button>
            <DisabledReasonButton
              className="app-primary-button justify-center"
              onClick={onCreateLimit}
              disabled={creatingLimit}
              disabledReason={creatingLimit ? undefined : blockedReason}
            >
              <PendingLabel pending={creatingLimit} name="Saving">
                Save
              </PendingLabel>
            </DisabledReasonButton>
          </div>
        ) : selectedLimit ? (
          <div className="space-y-2">
            <button
              type="button"
              className={`app-danger-button w-full justify-center min-[750px]:hidden ${selectedLimitDeleting ? 'app-primary-button-loading' : ''}`}
              onClick={() => onDeleteLimit(selectedLimit)}
              disabled={selectedSavingLimit || selectedLimitDeleting}
            >
              <PendingLabel pending={selectedLimitDeleting} name="Deleting" className="gap-2">
                {selectedLimitDeleteConfirming ? (
                  'Confirm delete'
                ) : (
                  <>
                    <Trash2 size={16} aria-hidden />
                    Delete year
                  </>
                )}
              </PendingLabel>
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="app-secondary-button justify-center"
                onClick={onClose}
                disabled={selectedSavingLimit}
              >
                Cancel
              </button>
              <DisabledReasonButton
                className="app-primary-button justify-center"
                onClick={() => onSaveLimit(selectedLimit.year)}
                disabled={selectedSavingLimit}
                disabledReason={selectedSavingLimit ? undefined : blockedReason}
              >
                <PendingLabel pending={selectedSavingLimit} name="Saving">
                  Save
                </PendingLabel>
              </DisabledReasonButton>
            </div>
          </div>
        ) : null}
      </div>
    </ModalShell>
  )
}

/**
 * Renders an existing annual limit currency field bound to the selected tax year
 */
function renderLimitEditorField(
  year: number,
  key: TaxPlanLimitDraftField,
  label: string,
  ariaLabel: string,
  value: string,
  currencies: Currency[],
  plan: TaxAdvantagedCategory,
  problems: FieldProblems<LimitField>,
  onLimitFieldChange: (year: number, key: TaxPlanLimitDraftField, value: string) => void,
  placeholder?: string,
) {
  const id = EXISTING_LIMIT_CONTROL_IDS[key]
  const errorId = getLimitErrorId(id)

  return (
    <div className="min-w-0">
      <FieldLabelRow
        compact
        htmlFor={id}
        label={label}
        error={problems[key]}
        errorId={errorId}
        spacingClassName="mb-1"
      />
      <CompactCurrencyInput
        ariaLabel={`${year} ${ariaLabel.toLowerCase()}`}
        hasError={!!problems[key]}
        errorId={errorId}
        id={id}
        currencies={currencies}
        currency={plan.currency}
        value={value}
        onChange={(nextValue) => onLimitFieldChange(year, key, nextValue)}
        placeholder={placeholder}
      />
    </div>
  )
}

/**
 * Renders a new annual limit currency field bound to the add-year draft
 */
function renderNewLimitEditorField(
  key: keyof TaxPlanLimitDraftState,
  label: string,
  ariaLabel: string,
  currencies: Currency[],
  plan: TaxAdvantagedCategory,
  newLimitForm: TaxPlanLimitFormState,
  problems: FieldProblems<LimitField>,
  onNewLimitFieldChange: <K extends keyof TaxPlanLimitFormState>(key: K, value: TaxPlanLimitFormState[K]) => void,
  placeholder?: string,
) {
  const id = NEW_LIMIT_CONTROL_IDS[key]
  const errorId = getLimitErrorId(id)

  return (
    <div className="min-w-0">
      <FieldLabelRow
        compact
        htmlFor={id}
        label={label}
        error={problems[key]}
        errorId={errorId}
        spacingClassName="mb-1"
      />
      <CompactCurrencyInput
        ariaLabel={ariaLabel}
        hasError={!!problems[key]}
        errorId={errorId}
        id={id}
        currencies={currencies}
        currency={plan.currency}
        value={newLimitForm[key]}
        onChange={(value) => onNewLimitFieldChange(key, value)}
        placeholder={placeholder}
      />
    </div>
  )
}
