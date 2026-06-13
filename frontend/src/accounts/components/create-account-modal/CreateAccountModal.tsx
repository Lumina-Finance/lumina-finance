import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Landmark, X } from 'lucide-react';
import Dropdown from '@/components/Dropdown';
import IconTooltip from '@/components/IconTooltip';
import CreateModalFieldLabelRow from '@/components/create-modal/CreateModalFieldLabelRow';
import CreateModalSectionFrame from '@/components/create-modal/CreateModalSectionFrame';
import { useCurrencies } from '@/api/currency';
import { useInstitutions } from '@/api/institutions';
import { useTaxAdvantagedCategories } from '@/api/taxAdvantagedCategories';
import CreateInstitutionModal from '@/components/CreateInstitutionModal';
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
  CREATE_ACCOUNT_TYPE_OPTIONS,
} from '@/accounts/components/create-account-modal/createAccountModalConstants';
import {
  buildCreateAccountPayload,
  buildCreateAccountViewModel,
  buildInitialCreateAccountForm,
  getNextCreateAccountForm,
  validateCreateAccountForm,
} from '@/accounts/components/create-account-modal/createAccountModalForm';
import {
  buildCreateAccountCurrencyOptions,
  buildCreateAccountInstitutionOptions,
  buildCreateAccountTaxPlanOptions,
} from '@/accounts/components/create-account-modal/createAccountModalOptions';
import type {
  CreateAccountFieldErrors,
  CreateAccountFormField,
  CreateAccountValidatedField,
} from '@/accounts/components/create-account-modal/createAccountModalTypes';

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

  // Scroll lock
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleChange = (field: CreateAccountFormField, value: string) => {
    setForm((current) => getNextCreateAccountForm(current, field, value));
    if (fieldErrors[field as CreateAccountValidatedField]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    }
    setSubmitError('');
  };

  // Institution creation sub-modal
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

  const handleSubmit = (e: React.FormEvent) => {
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
      {createPortal(
        <AnimatePresence>
          {open && (
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

              {/* Panel */}
              <motion.div
                className="fixed inset-0 z-50 flex items-center justify-center p-4"
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                transition={{ duration: 0.25, ease: CREATE_ACCOUNT_EASE }}
                onClick={onClose}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="create-account-title"
                  className="app-modal-panel flex max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-2xl"
                  style={{
                    background: 'var(--app-bg)',
                    border: '1px solid var(--app-border-strong)',
                    boxShadow: 'var(--app-shadow-soft)',
                  }}
                  onClick={(e) => e.stopPropagation()}
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
                      Account
                    </span>
                  </div>

                  <form onSubmit={handleSubmit} className="flex min-h-0 w-full flex-col" noValidate>
                    <div
                      className="shrink-0 pb-5 pl-4 pr-5 pt-6 sm:pt-7 min-[1050px]:px-8"
                      style={{ borderBottom: '1px solid var(--app-border)' }}
                    >
                      <div className="flex items-start justify-between gap-6">
                        <div className="min-w-0">
                          <p
                            className="mb-2 text-xs font-semibold uppercase"
                            style={{ color: 'var(--app-accent)' }}
                          >
                            {selectedAccountTypeLabel ?? 'New account'}
                          </p>
                          <h2
                            id="create-account-title"
                            className="font-serif text-3xl font-light"
                          >
                            Add Account
                          </h2>
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
                        <CreateModalSectionFrame step="01">
                          <div className="min-w-0 space-y-3">
                            <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Identity</p>

                            <div>
                              <CreateModalFieldLabelRow label="Account Type" error={showError('account_type') || undefined} />
                              <Dropdown
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
                    </div>

                    <div
                      className="grid shrink-0 grid-cols-2 gap-3 px-6 py-4 sm:flex sm:justify-end sm:px-8 min-[1050px]:py-5"
                      style={{ borderTop: '1px solid var(--app-border)' }}
                    >
                      <button
                        type="button"
                        className="app-secondary-button w-full sm:w-auto"
                        onClick={onClose}
                        disabled={mutation.isPending}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={mutation.isPending}
                        className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${mutation.isPending ? 'app-primary-button-loading justify-self-center sm:justify-self-auto' : 'w-full sm:w-40'}`}
                      >
                        {mutation.isPending ? <div className="app-spinner" /> : 'Create Account'}
                      </button>
                    </div>
                  </form>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}

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
