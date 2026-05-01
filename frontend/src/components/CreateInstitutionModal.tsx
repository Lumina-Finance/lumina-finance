import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Building2, X } from 'lucide-react';
import Dropdown from '@/components/Dropdown';
import { useCreateInstitution } from '@/api/institutions';
import { ApiError } from '@/api/auth';
import { COUNTRY_OPTIONS } from '@/constants/countries';
import type { Institution } from '@/api/accounts';

const EASE = [0.25, 0.1, 0.25, 1] as const;
const CREATE_INSTITUTION_MIN_LOADING_MS = 800;

const INITIAL_FORM = {
  name: '',
  country_code: '',
  website: '',
};

interface FieldErrors {
  name?: string;
  country_code?: string;
  website?: string;
}

interface FieldLabelRowProps {
  label: React.ReactNode;
  htmlFor?: string;
  error?: string;
}

function FieldLabelRow({ label, htmlFor, error }: FieldLabelRowProps) {
  return (
    <div className="mb-1.5 flex items-start justify-between gap-3">
      <label htmlFor={htmlFor} className="app-label block shrink-0 text-[0.9375rem] leading-5">
        {label}
      </label>
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
  if (!form.name.trim()) errors.name = 'Name is required';
  if (!form.country_code) errors.country_code = 'Select a country';
  if (!form.website.trim()) errors.website = 'Website is required';
  return errors;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

interface CreateInstitutionModalProps {
  open: boolean;
  initialName: string;
  onClose: () => void;
  onCreated: (institution: Institution) => void;
}

export default function CreateInstitutionModal({
  open,
  initialName,
  onClose,
  onCreated,
}: CreateInstitutionModalProps) {
  const mutation = useCreateInstitution();

  const [form, setForm] = useState(() => ({
    ...INITIAL_FORM,
    name: initialName,
  }));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState('');
  const [createInProgress, setCreateInProgress] = useState(false);
  const isCreating = mutation.isPending || createInProgress;

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleChange = (field: keyof typeof INITIAL_FORM, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    }
    setSubmitError('');
  };

  const handleBlur = (field: keyof FieldErrors) => {
    setTouched((t) => ({ ...t, [field]: true }));
    const errors = validate(form);
    setFieldErrors((prev) => ({ ...prev, [field]: errors[field] }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating) return;

    const errors = validate(form);
    setFieldErrors(errors);
    setTouched({ name: true, country_code: true, website: true });
    if (Object.keys(errors).length > 0) return;

    setCreateInProgress(true);
    const minimumLoading = delay(CREATE_INSTITUTION_MIN_LOADING_MS);

    void mutation.mutateAsync(
      {
        name: form.name.trim(),
        country_code: form.country_code.toUpperCase(),
        website: form.website.trim(),
      },
    ).then(async (institution) => {
      await minimumLoading;
      onCreated(institution);
    }).catch(async (err) => {
      await minimumLoading;
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setCreateInProgress(false);
    });
  };

  const showError = (field: keyof FieldErrors) => touched[field] && fieldErrors[field];

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[100]"
            style={{ background: 'rgba(0, 0, 0, 0.22)', backdropFilter: 'blur(6px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            aria-hidden
          />

          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 16 }}
            transition={{ duration: 0.22, ease: EASE }}
            onClick={onClose}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-institution-title"
              className="flex max-h-[84vh] w-full max-w-xl overflow-hidden rounded-2xl"
              style={{
                background: 'var(--app-bg)',
                border: '1px solid var(--app-border-strong)',
                boxShadow: 'var(--app-shadow-soft)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="hidden w-12 shrink-0 flex-col items-center justify-between py-5 sm:flex"
                style={{
                  background: 'var(--app-surface-soft)',
                  borderRight: '1px solid var(--app-border)',
                  color: 'var(--app-accent)',
                }}
                aria-hidden
              >
                <Building2 size={18} strokeWidth={2} />
                <span className="rotate-180 text-[0.6875rem] font-semibold uppercase" style={{ writingMode: 'vertical-rl' }}>
                  Linked
                </span>
              </div>

              <form onSubmit={handleSubmit} className="flex min-h-0 w-full flex-col" noValidate>
                <div
                  className="shrink-0 px-6 pb-5 pt-6 sm:px-7"
                  style={{ borderBottom: '1px solid var(--app-border)' }}
                >
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <p
                        className="mb-2 text-xs font-semibold uppercase"
                        style={{ color: 'var(--app-accent)' }}
                      >
                        Account setup
                      </p>
                      <h2
                        id="create-institution-title"
                        className="font-serif text-3xl font-light"
                      >
                        Add Institution
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

                <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-3 pt-4 sm:px-7">
                  <div className="space-y-5">
                    <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
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

                        <div>
                          <FieldLabelRow htmlFor="inst-name" label="Name" error={showError('name') || undefined} />
                          <input
                            id="inst-name"
                            type="text"
                            className={`app-input ${showError('name') ? 'app-input-error' : ''}`}
                            value={form.name}
                            onChange={(e) => handleChange('name', e.target.value)}
                            onBlur={() => handleBlur('name')}
                            maxLength={256}
                          />
                        </div>

                        <div>
                          <FieldLabelRow label="Country" error={showError('country_code') || undefined} />
                          <Dropdown
                            options={COUNTRY_OPTIONS}
                            value={form.country_code}
                            onChange={(v) => handleChange('country_code', v)}
                            className={`app-input ${showError('country_code') ? 'app-input-error' : ''}`}
                            placeholder="Select country..."
                            searchable
                            searchPlaceholder="Search countries..."
                          />
                        </div>
                      </div>
                    </section>

                    <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
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
                        <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Reference</p>

                        <div>
                          <FieldLabelRow htmlFor="inst-website" label="Website" error={showError('website') || undefined} />
                          <input
                            id="inst-website"
                            type="url"
                            className={`app-input ${showError('website') ? 'app-input-error' : ''}`}
                            placeholder="https://example.com"
                            value={form.website}
                            onChange={(e) => handleChange('website', e.target.value)}
                            onBlur={() => handleBlur('website')}
                          />
                        </div>
                      </div>
                    </section>

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
                  className="flex shrink-0 flex-col-reverse gap-3 px-6 py-5 sm:flex-row sm:justify-end sm:px-7"
                  style={{ borderTop: '1px solid var(--app-border)' }}
                >
                  <button
                    type="button"
                    className="app-secondary-button w-full sm:w-auto"
                    onClick={onClose}
                    disabled={isCreating}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating}
                    className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${isCreating ? 'app-primary-button-loading' : 'w-full sm:w-32'}`}
                  >
                    {isCreating ? <div className="app-spinner" /> : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
