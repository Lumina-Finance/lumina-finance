import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Landmark, X } from 'lucide-react';
import Dropdown from '@/components/Dropdown';
import IconTooltip from '@/components/IconTooltip';
import { useCurrencies } from '@/api/currency';
import { useInstitutions } from '@/api/institutions';
import { useTaxAdvantagedPlans } from '@/api/taxAdvantagedPlans';
import CreateInstitutionModal from '@/components/CreateInstitutionModal';
import {
  useCreateAccount,
  ACCOUNT_KIND_BY_TYPE,
  type AccountType,
  type CreateAccountPayload,
} from '@/api/accounts';
import { ApiError } from '@/api/auth';
import { useAuth } from '@/hooks/useAuth';

/* ── Constants ── */

const EASE = [0.25, 0.1, 0.25, 1] as const;

const ACCOUNT_TYPE_OPTIONS = [
  { value: 'checking', label: 'Checking', group: 'Assets' },
  { value: 'savings', label: 'Savings', group: 'Assets' },
  { value: 'term_deposit', label: 'Term Deposit', group: 'Assets' },
  { value: 'cash', label: 'Cash', group: 'Assets' },
  { value: 'investment', label: 'Investment', group: 'Assets' },
  { value: 'credit_card', label: 'Credit Card', group: 'Revolving credit' },
  { value: 'line_of_credit', label: 'Line of Credit', group: 'Revolving credit' },
  { value: 'heloc', label: 'HELOC', group: 'Revolving credit' },
  { value: 'loan', label: 'Loan', group: 'Amortizing debt' },
  { value: 'mortgage', label: 'Mortgage', group: 'Amortizing debt' },
];

const INITIAL_FORM = {
  account_type: '',
  name: '',
  currency: '',
  institution_id: '',
  tax_advantaged_category_id: '',
  credit_limit: '',
  starting_balance: '',
};

// Shared animation for conditional fields sliding in/out
const conditionalField = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.25, ease: EASE },
};

function sanitizeMoneyInput(value: string) {
  let sanitized = value.replace(/[^\d.]/g, '');
  const parts = sanitized.split('.');
  if (parts.length > 1) sanitized = `${parts[0]}.${parts.slice(1).join('')}`;
  if (sanitized.startsWith('.')) sanitized = `0${sanitized}`;
  return sanitized;
}

function formatMoneyInputLive(value: string) {
  if (!value.trim()) return value;
  const [integerPart, decimalPart] = value.split('.', 2);
  const formattedInteger = integerPart
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(integerPart))
    : '0';
  return value.includes('.') ? `${formattedInteger}.${decimalPart ?? ''}` : formattedInteger;
}

/* ── Validation ── */

interface FieldErrors {
  account_type?: string;
  name?: string;
  currency?: string;
  credit_limit?: string;
  starting_balance?: string;
}

interface FieldLabelRowProps {
  label: React.ReactNode;
  htmlFor?: string;
  error?: string;
  accessory?: React.ReactNode;
}

function FieldLabelRow({ label, htmlFor, error, accessory }: FieldLabelRowProps) {
  return (
    <div className="mb-1.5 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <label htmlFor={htmlFor} className="app-label block shrink-0 text-[0.9375rem] leading-5">
          {label}
        </label>
        {accessory}
      </div>
      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            key={error}
            className="text-right text-xs font-medium leading-5"
            style={{ color: 'var(--app-negative)' }}
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            transition={{ duration: 0.15 }}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function validate(form: typeof INITIAL_FORM): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.account_type) errors.account_type = 'Select an account type';
  if (!form.name.trim()) errors.name = 'Name is required';
  else if (form.name.trim().length > 256) errors.name = 'Name must be 256 characters or less';
  if (!form.currency) errors.currency = 'Select a currency';

  if (form.credit_limit) {
    const n = Number(form.credit_limit.replace(/,/g, ''));
    if (isNaN(n) || n < 0) errors.credit_limit = 'Must be a positive number';
  }
  if (form.starting_balance) {
    const n = Number(form.starting_balance.replace(/,/g, ''));
    if (isNaN(n) || n < 0) errors.starting_balance = 'Must be zero or higher';
  }
  return errors;
}

/* ── Component ── */

interface CreateAccountModalProps {
  open: boolean;
  onClose: () => void;
}

export default function CreateAccountModal({ open, onClose }: CreateAccountModalProps) {
  const { user } = useAuth();
  const mutation = useCreateAccount();
  const { data: currencies = [] } = useCurrencies();
  const { data: institutions = [] } = useInstitutions();
  const { data: taxAdvantagedPlans = [] } = useTaxAdvantagedPlans();

  const [form, setForm] = useState(() => ({
    ...INITIAL_FORM,
    currency: user?.base_currency ?? '',
  }));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState('');

  // Derived state
  const accountKind = form.account_type
    ? ACCOUNT_KIND_BY_TYPE[form.account_type as AccountType]
    : undefined;
  // credit_limit applies only to revolving-credit products (credit cards,
  // LOCs, HELOCs). Amortizing debt has a fixed principal schedule, not a limit.
  const isRevolving = accountKind === 'revolving';
  const isLiability = accountKind === 'revolving' || accountKind === 'amortizing';
  const canLinkTaxPlan = accountKind === 'asset' && !!form.currency;
  const conditionalAccountField = canLinkTaxPlan ? 'tax-plan' : isRevolving ? 'credit-limit' : null;
  const selectedAccountType = ACCOUNT_TYPE_OPTIONS.find((option) => option.value === form.account_type);
  const selectedCurrencySymbol = currencies.find((currency) => currency.id === form.currency)?.symbol ?? '';
  const startingBalanceLabel = isLiability ? 'Starting Amount Owed' : 'Starting Balance';

  // Dropdown options
  const currencyOptions = useMemo(
    () => currencies.map((c) => ({ value: c.id, label: `${c.id} — ${c.name} (${c.symbol})` })),
    [currencies],
  );
  const institutionOptions = useMemo(
    () => [
      { value: '', label: 'None' },
      ...institutions.map((i) => ({ value: i.id, label: i.name })),
    ],
    [institutions],
  );
  const taxPlanOptions = useMemo(
    () => [
      { value: '', label: 'None' },
      ...taxAdvantagedPlans
        .filter((plan) => plan.group_id === null && plan.currency === form.currency)
        .map((plan) => ({ value: plan.id, label: plan.name })),
    ],
    [form.currency, taxAdvantagedPlans],
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

  const handleChange = (field: keyof typeof INITIAL_FORM, value: string) => {
    setForm((f) => {
      const next = { ...f, [field]: value };
      // Reset dependent fields when their controlling field changes
      if (field === 'account_type') {
        const nextKind = value ? ACCOUNT_KIND_BY_TYPE[value as AccountType] : undefined;
        if (nextKind !== 'revolving') next.credit_limit = '';
        if (nextKind !== 'asset') next.tax_advantaged_category_id = '';
      }
      if (field === 'currency') {
        next.tax_advantaged_category_id = '';
      }
      return next;
    });
    if (fieldErrors[field as keyof FieldErrors]) {
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

  const handleBlur = (field: keyof FieldErrors) => {
    setTouched((t) => ({ ...t, [field]: true }));
    const errors = validate(form);
    setFieldErrors((prev) => ({ ...prev, [field]: errors[field] }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const errors = validate(form);
    setFieldErrors(errors);
    setTouched({ account_type: true, name: true, currency: true, credit_limit: true, starting_balance: true });
    if (Object.keys(errors).length > 0) return;

    // Convert user-entered major units (e.g. dollars) to minor units (e.g. cents)
    const selectedCurrency = currencies.find((c) => c.id === form.currency);
    const minorMultiplier = Math.pow(10, selectedCurrency?.minor_unit_exponent ?? 2);

    const toMinor = (value: string): number | null => {
      if (!value) return null;
      const n = parseFloat(value.replace(/,/g, ''));
      if (isNaN(n) || n < 0) return null;
      return Math.round(n * minorMultiplier);
    };

    const payload: CreateAccountPayload = {
      account_kind: ACCOUNT_KIND_BY_TYPE[form.account_type as AccountType],
      account_type: form.account_type as AccountType,
      tax_advantaged_category_id: form.tax_advantaged_category_id || null,
      name: form.name.trim(),
      institution_id: form.institution_id || null,
      currency: form.currency,
      credit_limit: isRevolving ? toMinor(form.credit_limit) : null,
      starting_balance: (() => {
        const amount = toMinor(form.starting_balance);
        if (amount === null) return null;
        return isLiability ? -amount : amount;
      })(),
      is_archived: false,
    };

    mutation.mutate(payload, {
      onSuccess: () => onClose(),
      onError: (err) => {
        setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      },
    });
  };

  const showError = (field: keyof FieldErrors) => touched[field] && fieldErrors[field];

  return (
    <>
      {createPortal(
        <AnimatePresence>
          {open && (
            <>
              {/* Backdrop */}
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
                transition={{ duration: 0.25, ease: EASE }}
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

                  {/* Form */}
                  <form onSubmit={handleSubmit} className="flex min-h-0 w-full flex-col" noValidate>
                    {/* Header */}
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
                            {selectedAccountType?.label ?? 'New account'}
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

                            {/* Account Type */}
                            <div>
                              <FieldLabelRow label="Account Type" error={showError('account_type') || undefined} />
                              <Dropdown
                                options={ACCOUNT_TYPE_OPTIONS}
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

                            {/* Account Name */}
                            <div>
                              <FieldLabelRow htmlFor="account-name" label="Account Name" error={showError('name') || undefined} />
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

                            {/* Currency */}
                            <div>
                              <FieldLabelRow label="Currency" error={showError('currency') || undefined} />
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
                            <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Details</p>

                            {/* Institution */}
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
                              <FieldLabelRow
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
                                      <FieldLabelRow
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
                        </section>

                        {/* Submit error */}
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

                    {/* Footer */}
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
