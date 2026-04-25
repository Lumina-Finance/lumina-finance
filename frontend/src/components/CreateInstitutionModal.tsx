import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import Dropdown from '@/components/Dropdown';
import { useCreateInstitution } from '@/api/institutions';
import { ApiError } from '@/api/auth';
import { COUNTRY_OPTIONS } from '@/constants/countries';
import type { Institution } from '@/api/accounts';

const EASE = [0.25, 0.1, 0.25, 1] as const;

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
    name: initialName,
    country_code: '',
    website: '',
  }));
  const [error, setError] = useState('');

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.country_code) { setError('Select a country'); return; }
    if (!form.website.trim()) { setError('Website is required'); return; }

    mutation.mutate(
      {
        name: form.name.trim(),
        country_code: form.country_code.toUpperCase(),
        website: form.website.trim(),
      },
      {
        onSuccess: (institution) => onCreated(institution),
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        },
      },
    );
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — higher z-index since this sits above the account modal */}
          <motion.div
            className="fixed inset-0 z-[100]"
            style={{ background: 'rgba(0, 0, 0, 0.25)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            aria-hidden
          />

          {/* Panel */}
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-institution-title"
              className="w-full max-w-sm rounded-2xl p-6"
              style={{
                background: 'var(--app-bg)',
                border: '1px solid var(--app-border-strong)',
                boxShadow: 'var(--app-shadow-soft)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <h2
                  id="create-institution-title"
                  className="font-serif text-2xl font-light tracking-tight"
                >
                  New Institution
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="app-icon-button shrink-0"
                  aria-label="Close"
                >
                  <X size={18} aria-hidden />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="inst-name" className="app-label block mb-1.5">Name</label>
                  <input
                    id="inst-name"
                    type="text"
                    className="app-input"
                    value={form.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    maxLength={256}
                  />
                </div>

                <div>
                  <label className="app-label block mb-1.5">Country</label>
                  <Dropdown
                    options={COUNTRY_OPTIONS}
                    value={form.country_code}
                    onChange={(v) => handleChange('country_code', v)}
                    placeholder="Select country..."
                    searchable
                    searchPlaceholder="Search countries..."
                  />
                </div>

                <div>
                  <label htmlFor="inst-website" className="app-label block mb-1.5">Website</label>
                  <input
                    id="inst-website"
                    type="url"
                    className="app-input"
                    placeholder="https://example.com"
                    value={form.website}
                    onChange={(e) => handleChange('website', e.target.value)}
                  />
                </div>

                {/* Error */}
                <AnimatePresence>
                  {error && (
                    <motion.p
                      className="text-sm font-medium"
                      style={{ color: 'var(--app-negative)' }}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                    >
                      {error}
                    </motion.p>
                  )}
                </AnimatePresence>

                {/* Footer */}
                <div
                  className="flex items-center justify-end gap-3 pt-3"
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
                    {mutation.isPending ? <div className="app-spinner" /> : 'Create'}
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
