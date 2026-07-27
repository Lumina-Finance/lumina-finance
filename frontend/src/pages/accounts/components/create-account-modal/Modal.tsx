import { useState, useMemo, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Dropdown from '@/components/dropdown/Dropdown';
import IconTooltip from '@/components/tooltips/IconTooltip';
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow';
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame';
import CreateAccountModalShell from '@/pages/accounts/components/create-account-modal/Shell';
import { useCurrencies } from '@/api/currency';
import { useInstitutions } from '@/api/institutions';
import { useTaxAdvantagedCategories } from '@/api/tax-advantaged-categories';
import CreateInstitutionModal from '@/components/reference-modals/CreateInstitutionModal';
import { useCreateAccount } from '@/api/accounts';
import { ApiError } from '@/api/auth';
import { useAuth } from '@/hooks/useAuth';
import {
  formatMoneyInputLive,
  sanitizeMoneyInput,
} from '@/utils/moneyInput';
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

  const [institutionModalName, setInstitutionModalName] = useState('');
  const [showInstitutionModal, setShowInstitutionModal] = useState(false);
  const [institutionModalKey, setInstitutionModalKey] = useState(0);

  const handleCreateInstitution = (name: string) => {
    setInstitutionModalName(name);
    setInstitutionModalKey((k) => k + 1);
    setShowInstitutionModal(true);
  };

  const handleInstitutionCreated = (institution: { id: string }) => {
    handleChange('institution_id', institution.id);
    setShowInstitutionModal(false);
  };

  const handleBlur = (field: CreateAccountValidatedField) => {
    setTouched((t) => ({ ...t, [field]: true }));
    const errors = validateCreateAccountForm(form);
    setFieldErrors((prev) => ({ ...prev, [field]: errors[field] }));
  };

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
      <CreateAccountModalShell
        open={open}
        isSubmitting={mutation.isPending}
        selectedAccountTypeLabel={selectedAccountTypeLabel}
        onClose={onClose}
        onSubmit={handleSubmit}
      >
        <div className="space-y-5">
          <CreateModalSectionFrame step="01">
            <div className="min-w-0 space-y-3">
              <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Identity</p>

              <div>
                <CreateModalFieldLabelRow label="Account Type" error={showError('account_type') || undefined} />
                <Dropdown
                  id={CREATE_ACCOUNT_MODAL_FIELD_IDS.accountType}
                  options={CREATE_ACCOUNT_TYPE_OPTIONS}
                  value={form.account_type}
                  onChange={(v) => handleChange('account_type', v)}
                  className={`app-input ${showError('account_type') ? 'app-input-error' : ''}`}
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
                <CreateModalFieldLabelRow label="Currency" error={showError('currency') || undefined} />
                <Dropdown
                  id={CREATE_ACCOUNT_MODAL_FIELD_IDS.currency}
                  options={currencyOptions}
                  value={form.currency}
                  onChange={(v) => handleChange('currency', v)}
                  className={`app-input ${showError('currency') ? 'app-input-error' : ''}`}
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
                <label className="app-label mb-1.5 block text-[0.9375rem] leading-5">Institution</label>
                <Dropdown
                  id={CREATE_ACCOUNT_MODAL_FIELD_IDS.institution}
                  options={institutionOptions}
                  value={form.institution_id}
                  onChange={(v) => handleChange('institution_id', v)}
                  placeholder="Select institution..."
                  searchable
                  searchPlaceholder="Search institutions..."
                  onCreateNew={handleCreateInstitution}
                  createNewLabel={(query) => query ? `Create institution "${query}"` : 'Create institution'}
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
                    inputMode="decimal"
                    placeholder="Optional"
                    value={form.starting_balance}
                    onChange={(e) => handleChange(
                      'starting_balance',
                      formatMoneyInputLive(sanitizeMoneyInput(e.target.value)),
                    )}
                    onBlur={() => handleBlur('starting_balance')}
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
                        <label className="app-label mb-1.5 block text-[0.9375rem] leading-5">Tax-Advantaged Category</label>
                        <Dropdown
                          id={CREATE_ACCOUNT_MODAL_FIELD_IDS.taxAdvantagedCategory}
                          options={taxPlanOptions}
                          value={form.tax_advantaged_category_id}
                          onChange={(v) => handleChange('tax_advantaged_category_id', v)}
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
                            inputMode="decimal"
                            placeholder="Optional"
                            value={form.credit_limit}
                            onChange={(e) => handleChange(
                              'credit_limit',
                              formatMoneyInputLive(sanitizeMoneyInput(e.target.value)),
                            )}
                            onBlur={() => handleBlur('credit_limit')}
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
      </CreateAccountModalShell>

      <CreateInstitutionModal
        key={institutionModalKey}
        open={showInstitutionModal}
        initialName={institutionModalName}
        onClose={() => setShowInstitutionModal(false)}
        onCreated={handleInstitutionCreated}
      />
    </>
  );
}
