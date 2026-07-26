import { AnimatePresence, motion } from 'motion/react'
import { Pencil, Trash2, X } from 'lucide-react'
import type { Currency } from '@/api/currency'
import type {
  TaxAdvantagedCategory,
  TaxAdvantagedCategoryLimit,
} from '@/api/tax-advantaged-categories'
import type {
  TaxPlanLimitDraftField,
  TaxPlanLimitDraftState,
  TaxPlanLimitFormState,
} from '@/pages/settings/components/tax-advantaged/types'
import { CompactCurrencyInput } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/controls/FormControls'

interface TaxAdvantagedLimitDetailsModalProps {
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
  selectedLimit: TaxAdvantagedCategoryLimit | null
  selectedLimitDeleteConfirming: boolean
  selectedLimitDeleting: boolean
  selectedLimitDirty: boolean
  selectedSavingLimit: boolean
  selectedDraft: TaxPlanLimitDraftState | null
  showAddTaxYear: boolean
}

/**
 * Renders the add and edit dialogs for annual TAC limits
 */
export default function TaxAdvantagedLimitDetailsModal({
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
  selectedLimit,
  selectedLimitDeleteConfirming,
  selectedLimitDeleting,
  selectedLimitDirty,
  selectedSavingLimit,
  selectedDraft,
  showAddTaxYear,
}: TaxAdvantagedLimitDetailsModalProps) {
  return (
    <AnimatePresence>
      {(showAddTaxYear || (selectedLimit && selectedDraft)) && (
        <>
          <motion.div
            className="fixed inset-0 z-[60]"
            style={{ background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(10px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            className="fixed inset-0 z-[61] flex items-stretch justify-center p-0 min-[620px]:items-center min-[620px]:p-4"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
            onClick={onClose}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="tax-year-limit-title"
              className="app-modal-panel flex max-h-[100dvh] min-h-[100dvh] w-full flex-col overflow-hidden rounded-none min-[620px]:min-h-0 min-[620px]:max-h-[calc(100dvh-2rem)] min-[620px]:max-w-[38rem] min-[620px]:rounded-2xl"
              style={{
                background: 'var(--app-bg)',
                border: '1px solid var(--app-border-strong)',
                boxShadow: 'var(--app-shadow-soft)',
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex shrink-0 items-start justify-between gap-4 border-b p-5" style={{ borderColor: 'var(--app-border)' }}>
                <div className="min-w-0">
                  <h4 id="tax-year-limit-title" className="font-serif text-2xl font-medium tracking-tight">
                    {showAddTaxYear ? 'New Year' : selectedLimit?.year}
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
                      <span className="app-label mb-1 block text-xs">Year</span>
                      <div
                        className="group flex h-9 w-full items-center gap-1.5 rounded-md border border-transparent px-2 transition-colors duration-150 hover:border-[var(--app-border)] focus-within:border-[var(--app-accent-border)]"
                        style={{ background: 'color-mix(in srgb, var(--app-input-bg) 55%, var(--app-bg))' }}
                      >
                        <input
                          aria-label="New tax year"
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
                          className="shrink-0 opacity-45 transition-opacity duration-150 group-hover:opacity-70 group-focus-within:opacity-80"
                          style={{ color: 'var(--app-text-subtle)' }}
                          aria-hidden
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Contribution</p>
                      <div className="grid grid-cols-2 gap-3">
                        {renderNewLimitEditorField('contribution_limit', 'Limit', 'New tax-year contribution limit', currencies, plan, newLimitForm, onNewLimitFieldChange, 'Required')}
                        {renderNewLimitEditorField('accrued_contributions', 'Opening', 'New tax-year opening contributions', currencies, plan, newLimitForm, onNewLimitFieldChange, '0')}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Withdrawal</p>
                      <div className="grid grid-cols-2 gap-3">
                        {renderNewLimitEditorField('withdrawal_limit', 'Limit', 'New tax-year withdrawal limit', currencies, plan, newLimitForm, onNewLimitFieldChange, 'Optional')}
                        {renderNewLimitEditorField('accrued_withdrawals', 'Opening', 'New tax-year opening withdrawals', currencies, plan, newLimitForm, onNewLimitFieldChange, '0')}
                      </div>
                    </div>
                    {limitError && (
                      <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
                        {limitError}
                      </p>
                    )}
                  </div>
                ) : selectedLimit && selectedDraft ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Contribution</p>
                      <div className="grid grid-cols-2 gap-3">
                        {renderLimitEditorField(selectedLimit.year, 'contribution_limit', 'Limit', 'Contribution limit', selectedDraft.contribution_limit, currencies, plan, onLimitFieldChange)}
                        {renderLimitEditorField(selectedLimit.year, 'accrued_contributions', 'Opening', 'Opening contributions', selectedDraft.accrued_contributions, currencies, plan, onLimitFieldChange, '0')}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Withdrawal</p>
                      <div className="grid grid-cols-2 gap-3">
                        {renderLimitEditorField(selectedLimit.year, 'withdrawal_limit', 'Limit', 'Withdrawal limit', selectedDraft.withdrawal_limit, currencies, plan, onLimitFieldChange, 'Optional')}
                        {renderLimitEditorField(selectedLimit.year, 'accrued_withdrawals', 'Opening', 'Opening withdrawals', selectedDraft.accrued_withdrawals, currencies, plan, onLimitFieldChange, '0')}
                      </div>
                    </div>
                    {limitError && (
                      <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
                        {limitError}
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 border-t px-5 py-4" style={{ borderColor: 'var(--app-border)' }}>
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
                    <button
                      type="button"
                      className="app-primary-button justify-center"
                      onClick={onCreateLimit}
                      disabled={creatingLimit}
                    >
                      {creatingLimit ? <div className="app-spinner" aria-label="Saving" /> : 'Save'}
                    </button>
                  </div>
                ) : selectedLimit ? (
                  <div className="space-y-2">
                    <button
                      type="button"
                      className={`app-danger-button w-full justify-center min-[750px]:hidden ${selectedLimitDeleting ? 'app-primary-button-loading' : ''}`}
                      onClick={() => onDeleteLimit(selectedLimit)}
                      disabled={selectedSavingLimit || selectedLimitDeleting}
                    >
                      {selectedLimitDeleting ? (
                        <div className="app-spinner" aria-label="Deleting" />
                      ) : selectedLimitDeleteConfirming ? (
                        'Confirm delete'
                      ) : (
                        <>
                          <Trash2 size={16} aria-hidden />
                          Delete year
                        </>
                      )}
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
                      <button
                        type="button"
                        className="app-primary-button justify-center"
                        onClick={() => onSaveLimit(selectedLimit.year)}
                        disabled={selectedSavingLimit || !selectedLimitDirty}
                      >
                        {selectedSavingLimit ? <div className="app-spinner" aria-label="Saving" /> : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
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
  onLimitFieldChange: (year: number, key: TaxPlanLimitDraftField, value: string) => void,
  placeholder?: string,
) {
  return (
    <div className="min-w-0">
      <span className="app-label mb-1 block text-xs">{label}</span>
      <CompactCurrencyInput
        ariaLabel={`${year} ${ariaLabel.toLowerCase()}`}
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
  onNewLimitFieldChange: <K extends keyof TaxPlanLimitFormState>(key: K, value: TaxPlanLimitFormState[K]) => void,
  placeholder?: string,
) {
  return (
    <div className="min-w-0">
      <span className="app-label mb-1 block text-xs">{label}</span>
      <CompactCurrencyInput
        ariaLabel={ariaLabel}
        currencies={currencies}
        currency={plan.currency}
        value={newLimitForm[key]}
        onChange={(value) => onNewLimitFieldChange(key, value)}
        placeholder={placeholder}
      />
    </div>
  )
}
