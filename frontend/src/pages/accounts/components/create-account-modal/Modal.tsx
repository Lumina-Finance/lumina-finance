import { useState, useMemo, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Dropdown from '@/components/dropdown/Dropdown';
import IconTooltip from '@/components/tooltips/IconTooltip';
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow';
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame';
import { Landmark } from 'lucide-react';
import { ModalTitledPanel } from '@/components/modal/TitledPanel';
import { ModalFormFooter } from '@/components/modal/FormFooter';
import { useCurrencies } from '@/api/currency';
import { useInstitutions, type Institution } from '@/api/institutions';
import { useTaxAdvantagedCategories } from '@/api/tax-advantaged-categories';
import InstitutionModal from '@/components/reference-modals/InstitutionModal';
import { useCreateAccount } from '@/api/accounts';
import { ApiError } from '@/api/auth';
import { useAuth } from '@/hooks/useAuth';
import { useInstitutionModal } from '@/hooks/useInstitutionModal';
import { useMoneyInput } from '@/hooks/useMoneyInput';
import { getCurrencyExponent } from '@/utils/moneyInput';
import { getFieldLabelId } from '@/utils/fieldLabel';
import {
  ALL_CREATE_ACCOUNT_FIELDS_TOUCHED,
  CREATE_ACCOUNT_EASE,
  CREATE_ACCOUNT_MODAL_FIELD_IDS,
  CREATE_ACCOUNT_TYPE_OPTIONS,
} from '@/pages/accounts/components/create-account-modal/constants';
import {
  buildCreateAccountPayload,
  buildCreateAccountViewModel,
  buildInitialCreateAccountForm,
  getNextCreateAccountForm,
  validateCreateAccountForm,
} from '@/pages/accounts/components/create-account-modal/utils/form';
import {
  buildCreateAccountCurrencyOptions,
  buildCreateAccountInstitutionOptions,
  buildCreateAccountTaxPlanOptions,
} from '@/pages/accounts/components/create-account-modal/utils/options';
import type {
  CreateAccountFieldErrors,
  CreateAccountFormField,
  CreateAccountValidatedField,
} from '@/pages/accounts/components/create-account-modal/types';

const conditionalField = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.25, ease: CREATE_ACCOUNT_EASE },
};

interface CreateAccountModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Orchestrates account creation form state and nested institution creation
 */
export default function CreateAccountModal({ open, onClose }: CreateAccountModalProps) {
  const { user } = useAuth();
  const mutation = useCreateAccount();
  const { data: currencies = [] } = useCurrencies();
  const { data: institutions = [] } = useInstitutions();
  const { data: taxAdvantagedCategories = [] } = useTaxAdvantagedCategories();

  const [form, setForm] = useState(() => buildInitialCreateAccountForm(user?.base_currency));
  const [fieldErrors, setFieldErrors] = useState<CreateAccountFieldErrors>({});
  const [touched, setTouched] = useState<Partial<Record<CreateAccountValidatedField, boolean>>>({});
  const [submitError, setSubmitError] = useState('');

  const {
    conditionalAccountField,
    selectedAccountTypeLabel,
    selectedCurrencySymbol,
    startingBalanceLabel,
  } = buildCreateAccountViewModel(form, currencies);
  const currencyOptions = useMemo(
    () => buildCreateAccountCurrencyOptions(currencies),
    [currencies],
  );
  const institutionOptions = useMemo(
    () => buildCreateAccountInstitutionOptions(institutions),
    [institutions],
  );
  const taxPlanOptions = useMemo(
    () => buildCreateAccountTaxPlanOptions(taxAdvantagedCategories, form.currency),
    [form.currency, taxAdvantagedCategories],
  );

  const handleChange = (field: CreateAccountFormField, value: string) => {
    setForm((current) => getNextCreateAccountForm(current, field, value));
    if (fieldErrors[field as CreateAccountValidatedField]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    }
    setSubmitError('');
  };

  const institutionModal = useInstitutionModal(institutions);

  const handleInstitutionSaved = (institution: Institution) => {
    // A correction leaves the selection where it is, so only a new institution is selected here
    if (!institutionModal.institution) handleChange('institution_id', institution.id);
    institutionModal.close();
  };

  const handleBlur = (field: CreateAccountValidatedField) => {
    setTouched((t) => ({ ...t, [field]: true }));
    const errors = validateCreateAccountForm(form);
    setFieldErrors((prev) => ({ ...prev, [field]: errors[field] }));
  };

  const currencyExponent = getCurrencyExponent(currencies, form.currency);
  const startingBalanceInput = useMoneyInput({
    value: form.starting_balance,
    exponent: currencyExponent,
    onChange: (value) => handleChange('starting_balance', value),
    onBlur: () => handleBlur('starting_balance'),
  });
  const creditLimitInput = useMoneyInput({
    value: form.credit_limit,
    exponent: currencyExponent,
    onChange: (value) => handleChange('credit_limit', value),
    onBlur: () => handleBlur('credit_limit'),
  });

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const errors = validateCreateAccountForm(form);
    setFieldErrors(errors);
    setTouched(ALL_CREATE_ACCOUNT_FIELDS_TOUCHED);
    if (Object.keys(errors).length > 0) return;

    const payload = buildCreateAccountPayload(form, currencies);

    mutation.mutate(payload, {
      onSuccess: () => onClose(),
      onError: (err) => {
        setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      },
    });
  };

  const showError = (field: CreateAccountValidatedField) => touched[field] && fieldErrors[field];

  return (
    <>
      <ModalTitledPanel
        open={open}
        titleId="create-account-title"
        title="Add Account"
        eyebrow={selectedAccountTypeLabel ?? 'New account'}
        RailIcon={Landmark}
        railLabel="Account"
        onClose={onClose}
        onSubmit={handleSubmit}
        footer={
          <ModalFormFooter
            submitLabel="Create Account"
            submitDisabled={mutation.isPending}
            submitWidthClassName="w-full sm:w-40"
            onCancel={onClose}
          />
        }
      >
        <div className="space-y-5">
          <CreateModalSectionFrame step="01">
            <div className="min-w-0 space-y-3">
              <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Identity</p>

              <div>
                <CreateModalFieldLabelRow
                  htmlFor={CREATE_ACCOUNT_MODAL_FIELD_IDS.accountType}
                  label="Account Type"
                  error={showError('account_type') || undefined}
                />
                <Dropdown
                  id={CREATE_ACCOUNT_MODAL_FIELD_IDS.accountType}
                  options={CREATE_ACCOUNT_TYPE_OPTIONS}
                  value={form.account_type}
                  onChange={(v) => handleChange('account_type', v)}
                  hasError={!!showError('account_type')}
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
                <CreateModalFieldLabelRow htmlFor="account-name" label="Account Name" error={showError('name') || undefined} />
                <input
                  id="account-name"
                  type="text"
                  className={`app-input ${showError('name') ? 'app-input-error' : ''}`}
                  placeholder="e.g. Main Checking"
                  value={form.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  onBlur={() => handleBlur('name')}
                  maxLength={256}
                />
              </div>

              <div>
                <CreateModalFieldLabelRow
                  htmlFor={CREATE_ACCOUNT_MODAL_FIELD_IDS.currency}
                  label="Currency"
                  error={showError('currency') || undefined}
                />
                <Dropdown
                  id={CREATE_ACCOUNT_MODAL_FIELD_IDS.currency}
                  options={currencyOptions}
                  value={form.currency}
                  onChange={(v) => handleChange('currency', v)}
                  hasError={!!showError('currency')}
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
              <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Details</p>

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
                  createNewLabel={(query) => query ? `Create institution "${query}"` : 'Create institution'}
                  onEditSelected={institutionModal.openForCorrection}
                  editSelectedLabel="Correct institution"
                />
              </div>

              <div>
                <CreateModalFieldLabelRow
                  htmlFor="starting-balance"
                  label={startingBalanceLabel}
                  error={showError('starting_balance') || undefined}
                  accessory={(
                    <IconTooltip
                      label={`${startingBalanceLabel} info`}
                      placement="top"
                      widthClassName="w-56"
                      size={14}
                    >
                      If provided, this account will be created with a balance adjustment transaction for this amount.
                    </IconTooltip>
                  )}
                />
                <div className="relative">
                  {selectedCurrencySymbol && (
                    <span
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                      style={{ color: 'var(--app-text-subtle)' }}
                      aria-hidden
                    >
                      {selectedCurrencySymbol}
                    </span>
                  )}
                  <input
                    id="starting-balance"
                    className={`app-input ${selectedCurrencySymbol ? 'pl-8' : ''} ${showError('starting_balance') ? 'app-input-error' : ''}`}
                    placeholder="Optional"
                    {...startingBalanceInput}
                  />
                </div>
              </div>

              <AnimatePresence initial={false} mode="wait">
                {conditionalAccountField && (
                  <motion.div
                    key={conditionalAccountField}
                    className="overflow-hidden"
                    {...conditionalField}
                  >
                    {conditionalAccountField === 'tax-plan' ? (
                      <div>
                        <label
                          id={getFieldLabelId(CREATE_ACCOUNT_MODAL_FIELD_IDS.taxAdvantagedCategory)}
                          htmlFor={CREATE_ACCOUNT_MODAL_FIELD_IDS.taxAdvantagedCategory}
                          className="app-label mb-1.5 block text-[0.9375rem] leading-5"
                        >
                          Tax-Advantaged Category
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
                      </div>
                    ) : (
                      <div>
                        <CreateModalFieldLabelRow
                          htmlFor="credit-limit"
                          label="Credit Limit"
                          error={showError('credit_limit') || undefined}
                        />
                        <div className="relative">
                          {selectedCurrencySymbol && (
                            <span
                              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                              style={{ color: 'var(--app-text-subtle)' }}
                              aria-hidden
                            >
                              {selectedCurrencySymbol}
                            </span>
                          )}
                          <input
                            id="credit-limit"
                            className={`app-input ${selectedCurrencySymbol ? 'pl-8' : ''} ${showError('credit_limit') ? 'app-input-error' : ''}`}
                            placeholder="Optional"
                            {...creditLimitInput}
                          />
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </CreateModalSectionFrame>

          <AnimatePresence>
            {submitError && (
              <motion.p
                className="text-sm font-medium"
                style={{ color: 'var(--app-negative)' }}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
              >
                {submitError}
              </motion.p>
            )}
          </AnimatePresence>
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
  );
}
