import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import Dropdown from '@/components/Dropdown';
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
  tax_advantaged_plan_id: '',
  credit_limit: '',
};

// Shared animation for conditional fields sliding in/out
const conditionalField = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.25, ease: EASE },
};

/* ── Validation ── */

interface FieldErrors {
  account_type?: string;
  name?: string;
  currency?: string;
  credit_limit?: string;
}

function validate(form: typeof INITIAL_FORM): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.account_type) errors.account_type = 'Select an account type';
  if (!form.name.trim()) errors.name = 'Name is required';
  else if (form.name.trim().length > 256) errors.name = 'Name must be 256 characters or less';
  if (!form.currency) errors.currency = 'Select a currency';

  if (form.credit_limit) {
    const n = parseInt(form.credit_limit, 10);
    if (isNaN(n) || n < 0) errors.credit_limit = 'Must be a positive number';
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
  const canLinkTaxPlan = accountKind === 'asset' && !!form.currency;

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
        if (nextKind !== 'asset') next.tax_advantaged_plan_id = '';
      }
      if (field === 'currency') {
        next.tax_advantaged_plan_id = '';
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
    setTouched({ account_type: true, name: true, currency: true, credit_limit: true });
    if (Object.keys(errors).length > 0) return;

    // Convert user-entered major units (e.g. dollars) to minor units (e.g. cents)
    const selectedCurrency = currencies.find((c) => c.id === form.currency);
    const minorMultiplier = Math.pow(10, selectedCurrency?.minor_unit_exponent ?? 2);

    const toMinor = (value: string): number | null => {
      if (!value) return null;
      const n = parseFloat(value);
      if (isNaN(n) || n < 0) return null;
      return Math.round(n * minorMultiplier);
    };

    const payload: CreateAccountPayload = {
      account_kind: ACCOUNT_KIND_BY_TYPE[form.account_type as AccountType],
      account_type: form.account_type as AccountType,
      tax_advantaged_plan_id: form.tax_advantaged_plan_id || null,
      name: form.name.trim(),
      institution_id: form.institution_id || null,
      currency: form.currency,
      credit_limit: isRevolving ? toMinor(form.credit_limit) : null,
      is_hidden: false,
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
              className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl p-8"
              style={{
                background: 'var(--app-bg)',
                border: '1px solid var(--app-border-strong)',
                boxShadow: 'var(--app-shadow-soft)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-8">
                <h2
                  id="create-account-title"
                  className="font-serif text-3xl font-light tracking-tight"
                >
                  Add Account
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 rounded-lg p-1.5 transition-colors duration-150 hover:bg-[var(--app-accent-soft)]"
                  style={{ color: 'var(--app-text-subtle)' }}
                  aria-label="Close"
                >
                  <X size={20} aria-hidden />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                {/* Account Type */}
                <div>
                  <label className="app-label block mb-1.5">Account Type</label>
                  <Dropdown
                    options={ACCOUNT_TYPE_OPTIONS}
                    value={form.account_type}
                    onChange={(v) => handleChange('account_type', v)}
                    placeholder="Select type..."
                    searchable
                    searchPlaceholder="Search types..."
                  />
                  <AnimatePresence>
                    {showError('account_type') && (
                      <motion.p
                        className="mt-1 text-xs"
                        style={{ color: 'var(--app-negative)' }}
                        initial={{ opacity: 0, x: 4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 4 }}
                        transition={{ duration: 0.15 }}
                      >
                        {fieldErrors.account_type}
                      </motion.p>
                    )}
                  </AnimatePresence>
                  <p className="mt-1.5 text-xs italic" style={{ color: 'var(--app-text-subtle)' }}>
                    Cannot be changed after creation.
                  </p>
                </div>

                {/* Account Name */}
                <div>
                  <label htmlFor="account-name" className="app-label block mb-1.5">
                    Account Name
                  </label>
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
                  <AnimatePresence>
                    {showError('name') && (
                      <motion.p
                        className="mt-1 text-xs"
                        style={{ color: 'var(--app-negative)' }}
                        initial={{ opacity: 0, x: 4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 4 }}
                        transition={{ duration: 0.15 }}
                      >
                        {fieldErrors.name}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                {/* Currency */}
                <div>
                  <label className="app-label block mb-1.5">Currency</label>
                  <Dropdown
                    options={currencyOptions}
                    value={form.currency}
                    onChange={(v) => handleChange('currency', v)}
                    placeholder={currencies.length === 0 ? 'Loading currencies…' : 'Select currency...'}
                    searchable
                    searchPlaceholder="Search currencies..."
                  />
                  <AnimatePresence>
                    {showError('currency') && (
                      <motion.p
                        className="mt-1 text-xs"
                        style={{ color: 'var(--app-negative)' }}
                        initial={{ opacity: 0, x: 4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 4 }}
                        transition={{ duration: 0.15 }}
                      >
                        {fieldErrors.currency}
                      </motion.p>
                    )}
                  </AnimatePresence>
                  <p className="mt-1.5 text-xs italic" style={{ color: 'var(--app-text-subtle)' }}>
                    Cannot be changed after creation.
                  </p>
                </div>

                {/* Institution */}
                <div>
                  <label className="app-label block mb-1.5">Institution</label>
                  <Dropdown
                    options={institutionOptions}
                    value={form.institution_id}
                    onChange={(v) => handleChange('institution_id', v)}
                    placeholder="Select institution..."
                    searchable
                    searchPlaceholder="Search institutions..."
                    onCreateNew={handleCreateInstitution}
                  />
                </div>

                {canLinkTaxPlan && (
                  <div>
                    <label className="app-label block mb-1.5">Tax-Advantaged Plan</label>
                    <Dropdown
                      options={taxPlanOptions}
                      value={form.tax_advantaged_plan_id}
                      onChange={(v) => handleChange('tax_advantaged_plan_id', v)}
                      placeholder="Select plan..."
                      searchable
                      searchPlaceholder="Search plans..."
                    />
                  </div>
                )}

                {/* Conditional: Credit Limit */}
                <AnimatePresence>
                  {isRevolving && (
                    <motion.div className="overflow-hidden" {...conditionalField}>
                      <div className="pt-1">
                        <label htmlFor="credit-limit" className="app-label block mb-1.5">
                          Credit Limit
                        </label>
                        <input
                          id="credit-limit"
                          type="number"
                          min="0"
                          className={`app-input ${showError('credit_limit') ? 'app-input-error' : ''}`}
                          placeholder="Optional"
                          value={form.credit_limit}
                          onChange={(e) => handleChange('credit_limit', e.target.value)}
                          onBlur={() => handleBlur('credit_limit')}
                        />
                        <AnimatePresence>
                          {showError('credit_limit') && (
                            <motion.p
                              className="mt-1 text-xs"
                              style={{ color: 'var(--app-negative)' }}
                              initial={{ opacity: 0, x: 4 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 4 }}
                              transition={{ duration: 0.15 }}
                            >
                              {fieldErrors.credit_limit}
                            </motion.p>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

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

                {/* Footer */}
                <div
                  className="flex items-center justify-end gap-3 pt-4"
                  style={{ borderTop: '1px solid var(--app-border)' }}
                >
                  <button
                    type="button"
                    className="app-secondary-button"
                    onClick={onClose}
                    disabled={mutation.isPending}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={mutation.isPending}
                    className={`app-primary-button ${mutation.isPending ? 'app-primary-button-loading' : ''}`}
                  >
                    {mutation.isPending ? <div className="app-spinner" /> : 'Create Account'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>

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
