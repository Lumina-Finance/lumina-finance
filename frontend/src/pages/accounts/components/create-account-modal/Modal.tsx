import { useState, useMemo, type FormEvent } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { FormError } from '@/components/forms/FormError'
import Dropdown from '@/components/dropdown/Dropdown'
import LoadFailure from '@/components/errors/LoadFailure'
import IconTooltip from '@/components/tooltips/IconTooltip'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import { Landmark } from 'lucide-react'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { useCurrencies } from '@/api/currency'
import { useInstitutions, type Institution } from '@/api/institutions'
import { useTaxAdvantagedCategories } from '@/api/tax-advantaged-categories'
import InstitutionModal from '@/components/reference-modals/InstitutionModal'
import { useCreateAccount } from '@/api/accounts'
import { useAuth } from '@/hooks/useAuth'
import { useInstitutionModal } from '@/hooks/useInstitutionModal'
import { useMoneyInput } from '@/hooks/useMoneyInput'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { getCreateFailureMessage } from '@/utils/createFailure'
import { getSymbolInputStyle } from '@/utils/formatCurrency'
import { getCurrencyExponent } from '@/utils/moneyInput'
import { getFieldLabelId } from '@/utils/fieldLabel'
import {
  CREATE_ACCOUNT_CONTROL_IDS,
  CREATE_ACCOUNT_EASE,
  CREATE_ACCOUNT_ERROR_IDS,
  CREATE_ACCOUNT_MODAL_FIELD_IDS,
  CREATE_ACCOUNT_TYPE_OPTIONS,
  CREATE_ACCOUNT_VALIDATED_FIELDS,
} from '@/pages/accounts/components/create-account-modal/constants'
import {
  buildCreateAccountPayload,
  buildCreateAccountViewModel,
  buildInitialCreateAccountForm,
  getNextCreateAccountForm,
  validateCreateAccountForm,
} from '@/pages/accounts/components/create-account-modal/utils/form'
import {
  buildCreateAccountCurrencyOptions,
  buildCreateAccountInstitutionOptions,
  buildCreateAccountTaxPlanOptions,
} from '@/pages/accounts/components/create-account-modal/utils/options'
import type { CreateAccountFormField } from '@/pages/accounts/components/create-account-modal/types'

const conditionalField = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.25, ease: CREATE_ACCOUNT_EASE },
}

interface CreateAccountModalProps {
  open: boolean
  onClose: () => void
}

/**
 * Orchestrates account creation form state and nested institution creation
 */
export default function CreateAccountModal({ open, onClose }: CreateAccountModalProps) {
  const { user } = useAuth()
  const mutation = useCreateAccount()
  const { data: currencies = [] } = useCurrencies()
  const { data: institutions = [] } = useInstitutions()
  const {
    data: taxAdvantagedCategories = [],
    error: taxAdvantagedCategoriesError,
    isError: taxAdvantagedCategoriesFailed,
  } = useTaxAdvantagedCategories()

  const [form, setForm] = useState(() => buildInitialCreateAccountForm(user?.base_currency))
  const [submitError, setSubmitError] = useState('')
  const refusal = useRefusedSubmit(
    validateCreateAccountForm(form),
    CREATE_ACCOUNT_VALIDATED_FIELDS,
    CREATE_ACCOUNT_CONTROL_IDS,
  )
  const errors = refusal.errors

  const { conditionalAccountField, selectedAccountTypeLabel, selectedCurrencySymbol, startingBalanceLabel } =
    buildCreateAccountViewModel(form, currencies)
  const currencyOptions = useMemo(() => buildCreateAccountCurrencyOptions(currencies), [currencies])
  const institutionOptions = useMemo(() => buildCreateAccountInstitutionOptions(institutions), [institutions])
  const taxPlanOptions = useMemo(
    () => buildCreateAccountTaxPlanOptions(taxAdvantagedCategories, form.currency),
    [form.currency, taxAdvantagedCategories],
  )

  const handleChange = (field: CreateAccountFormField, value: string) => {
    setForm((current) => getNextCreateAccountForm(current, field, value))
    setSubmitError('')
  }

  const institutionModal = useInstitutionModal(institutions)

  const handleInstitutionSaved = (institution: Institution) => {
    // A correction leaves the selection where it is, so only a new institution is selected here
    if (!institutionModal.institution) handleChange('institution_id', institution.id)
    institutionModal.close()
  }

  const currencyExponent = getCurrencyExponent(currencies, form.currency)
  const startingBalanceInput = useMoneyInput({
    value: form.starting_balance,
    exponent: currencyExponent,
    onChange: (value) => handleChange('starting_balance', value),
    onBlur: () => refusal.touch('starting_balance'),
  })
  const creditLimitInput = useMoneyInput({
    value: form.credit_limit,
    exponent: currencyExponent,
    onChange: (value) => handleChange('credit_limit', value),
    onBlur: () => refusal.touch('credit_limit'),
  })

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!refusal.guard()) return

    const payload = buildCreateAccountPayload(form, currencies)

    mutation.mutate(payload, {
      onSuccess: () => onClose(),
      onError: (err) => {
        setSubmitError(getCreateFailureMessage(err, 'account'))
      },
    })
  }

  return (
    <>
      <ModalTitledPanel
        open={open}
        titleId="create-account-title"
        title="Add account"
        eyebrow={selectedAccountTypeLabel ?? 'New account'}
        RailIcon={Landmark}
        railLabel="Account"
        onClose={onClose}
        onSubmit={handleSubmit}
        footer={
          <ModalFormFooter
            submitLabel="Create account"
            submitDisabled={mutation.isPending}
            submitBlockedReason={refusal.blockedReason}
            submitWidthClassName="w-full sm:w-40"
            onCancel={onClose}
          />
        }
      >
        <div className="space-y-5">
          <CreateModalSectionFrame step="01">
            <div className="min-w-0 space-y-3">
              <p
                className="flex h-4 items-center text-base font-bold leading-none"
                style={{ color: 'var(--app-accent)' }}
              >
                Identity
              </p>

              <div>
                <CreateModalFieldLabelRow
                  htmlFor={CREATE_ACCOUNT_MODAL_FIELD_IDS.accountType}
                  label="Account type"
                  error={errors.account_type}
                  errorId={CREATE_ACCOUNT_ERROR_IDS.account_type}
                />
                <Dropdown
                  id={CREATE_ACCOUNT_MODAL_FIELD_IDS.accountType}
                  options={CREATE_ACCOUNT_TYPE_OPTIONS}
                  value={form.account_type}
                  onChange={(v) => handleChange('account_type', v)}
                  hasError={!!errors.account_type}
                  describedBy={errors.account_type ? CREATE_ACCOUNT_ERROR_IDS.account_type : undefined}
                  labelledBy={getFieldLabelId(CREATE_ACCOUNT_MODAL_FIELD_IDS.accountType)}
                  placeholder="Select type..."
                  searchable
                  searchPlaceholder="Search types..."
                />
                <p className="mt-1.5 text-xs italic" style={{ color: 'var(--app-text-subtle)' }}>
                  Cannot be changed after creation.
                </p>
              </div>

              <div>
                <CreateModalFieldLabelRow
                  htmlFor={CREATE_ACCOUNT_MODAL_FIELD_IDS.name}
                  label="Account name"
                  error={errors.name}
                  errorId={CREATE_ACCOUNT_ERROR_IDS.name}
                />
                <input
                  id={CREATE_ACCOUNT_MODAL_FIELD_IDS.name}
                  type="text"
                  className={`app-input ${errors.name ? 'app-input-error' : ''}`}
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby={errors.name ? CREATE_ACCOUNT_ERROR_IDS.name : undefined}
                  placeholder="e.g. Main Checking"
                  value={form.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  onBlur={() => refusal.touch('name')}
                  maxLength={256}
                />
              </div>

              <div>
                <CreateModalFieldLabelRow
                  htmlFor={CREATE_ACCOUNT_MODAL_FIELD_IDS.currency}
                  label="Currency"
                  error={errors.currency}
                  errorId={CREATE_ACCOUNT_ERROR_IDS.currency}
                />
                <Dropdown
                  id={CREATE_ACCOUNT_MODAL_FIELD_IDS.currency}
                  options={currencyOptions}
                  value={form.currency}
                  onChange={(v) => handleChange('currency', v)}
                  hasError={!!errors.currency}
                  describedBy={errors.currency ? CREATE_ACCOUNT_ERROR_IDS.currency : undefined}
                  labelledBy={getFieldLabelId(CREATE_ACCOUNT_MODAL_FIELD_IDS.currency)}
                  placeholder={currencies.length === 0 ? 'Loading currencies...' : 'Select currency...'}
                  searchable
                  searchPlaceholder="Search currencies..."
                />
                <p className="mt-1.5 text-xs italic" style={{ color: 'var(--app-text-subtle)' }}>
                  Cannot be changed after creation.
                </p>
              </div>
            </div>
          </CreateModalSectionFrame>

          <CreateModalSectionFrame step="02">
            <div className="min-w-0 space-y-3">
              <p
                className="flex h-4 items-center text-base font-bold leading-none"
                style={{ color: 'var(--app-accent)' }}
              >
                Details
              </p>

              <div>
                <label
                  id={getFieldLabelId(CREATE_ACCOUNT_MODAL_FIELD_IDS.institution)}
                  htmlFor={CREATE_ACCOUNT_MODAL_FIELD_IDS.institution}
                  className="app-label mb-1.5 block text-[0.9375rem] leading-5"
                >
                  Institution
                </label>
                <Dropdown
                  id={CREATE_ACCOUNT_MODAL_FIELD_IDS.institution}
                  options={institutionOptions}
                  value={form.institution_id}
                  onChange={(v) => handleChange('institution_id', v)}
                  labelledBy={getFieldLabelId(CREATE_ACCOUNT_MODAL_FIELD_IDS.institution)}
                  placeholder="Select institution..."
                  searchable
                  searchPlaceholder="Search institutions..."
                  onCreateNew={institutionModal.openForCreate}
                  createNewLabel={(query) => (query ? `Create institution "${query}"` : 'Create institution')}
                  onEditOption={institutionModal.openForCorrection}
                  editOptionLabel="Correct institution"
                />
              </div>

              <div>
                <CreateModalFieldLabelRow
                  htmlFor={CREATE_ACCOUNT_MODAL_FIELD_IDS.startingBalance}
                  label={startingBalanceLabel}
                  error={errors.starting_balance}
                  errorId={CREATE_ACCOUNT_ERROR_IDS.starting_balance}
                  accessory={
                    <IconTooltip label={`${startingBalanceLabel} info`} placement="top" widthClassName="w-56" size={14}>
                      If provided, this account will be created with a balance adjustment transaction for this amount.
                    </IconTooltip>
                  }
                />
                <div className="relative">
                  {selectedCurrencySymbol && (
                    <span
                      className="app-input-prefix pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                      aria-hidden
                    >
                      {selectedCurrencySymbol}
                    </span>
                  )}
                  <input
                    id={CREATE_ACCOUNT_MODAL_FIELD_IDS.startingBalance}
                    className={`app-input ${selectedCurrencySymbol ? 'pl-8' : ''} ${errors.starting_balance ? 'app-input-error' : ''}`}
                    style={getSymbolInputStyle(selectedCurrencySymbol)}
                    aria-invalid={errors.starting_balance ? true : undefined}
                    aria-describedby={errors.starting_balance ? CREATE_ACCOUNT_ERROR_IDS.starting_balance : undefined}
                    placeholder="Optional"
                    {...startingBalanceInput}
                  />
                </div>
              </div>

              <AnimatePresence initial={false} mode="wait">
                {conditionalAccountField && (
                  <motion.div key={conditionalAccountField} className="overflow-hidden" {...conditionalField}>
                    {conditionalAccountField === 'tax-plan' ? (
                      <div>
                        <label
                          id={getFieldLabelId(CREATE_ACCOUNT_MODAL_FIELD_IDS.taxAdvantagedCategory)}
                          htmlFor={CREATE_ACCOUNT_MODAL_FIELD_IDS.taxAdvantagedCategory}
                          className="app-label mb-1.5 block text-[0.9375rem] leading-5"
                        >
                          Tax-advantaged category
                        </label>
                        <Dropdown
                          id={CREATE_ACCOUNT_MODAL_FIELD_IDS.taxAdvantagedCategory}
                          options={taxPlanOptions}
                          value={form.tax_advantaged_category_id}
                          onChange={(v) => handleChange('tax_advantaged_category_id', v)}
                          labelledBy={getFieldLabelId(CREATE_ACCOUNT_MODAL_FIELD_IDS.taxAdvantagedCategory)}
                          placeholder="Select category..."
                          searchable
                          searchPlaceholder="Search categories..."
                        />
                        {/* Beside the dropdown rather than in place of the form, since the
                            category is optional and the account can still be created without one */}
                        {taxAdvantagedCategoriesFailed && (
                          <LoadFailure
                            className="pt-3"
                            error={taxAdvantagedCategoriesError}
                            subject="Tax-advantaged categories"
                          />
                        )}
                      </div>
                    ) : (
                      <div>
                        <CreateModalFieldLabelRow
                          htmlFor={CREATE_ACCOUNT_MODAL_FIELD_IDS.creditLimit}
                          label="Credit limit"
                          error={errors.credit_limit}
                          errorId={CREATE_ACCOUNT_ERROR_IDS.credit_limit}
                        />
                        <div className="relative">
                          {selectedCurrencySymbol && (
                            <span
                              className="app-input-prefix pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                              aria-hidden
                            >
                              {selectedCurrencySymbol}
                            </span>
                          )}
                          <input
                            id={CREATE_ACCOUNT_MODAL_FIELD_IDS.creditLimit}
                            className={`app-input ${selectedCurrencySymbol ? 'pl-8' : ''} ${errors.credit_limit ? 'app-input-error' : ''}`}
                            style={getSymbolInputStyle(selectedCurrencySymbol)}
                            aria-invalid={errors.credit_limit ? true : undefined}
                            aria-describedby={errors.credit_limit ? CREATE_ACCOUNT_ERROR_IDS.credit_limit : undefined}
                            placeholder="Optional"
                            {...creditLimitInput}
                          />
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <div>
                <CreateModalFieldLabelRow
                  htmlFor={CREATE_ACCOUNT_MODAL_FIELD_IDS.notes}
                  label="Notes"
                  error={errors.notes}
                  errorId={CREATE_ACCOUNT_ERROR_IDS.notes}
                />
                <textarea
                  id={CREATE_ACCOUNT_MODAL_FIELD_IDS.notes}
                  className={`app-input h-auto resize-none py-2 ${errors.notes ? 'app-input-error' : ''}`}
                  aria-invalid={errors.notes ? true : undefined}
                  aria-describedby={errors.notes ? CREATE_ACCOUNT_ERROR_IDS.notes : undefined}
                  placeholder="Optional"
                  rows={3}
                  value={form.notes}
                  onChange={(event) => handleChange('notes', event.target.value)}
                  onBlur={() => refusal.touch('notes')}
                />
              </div>
            </div>
          </CreateModalSectionFrame>

          <FormError message={submitError} />
        </div>
      </ModalTitledPanel>

      <InstitutionModal
        key={institutionModal.key}
        open={institutionModal.open}
        initialName={institutionModal.name}
        institution={institutionModal.institution}
        onClose={institutionModal.close}
        onSaved={handleInstitutionSaved}
      />
    </>
  )
}
