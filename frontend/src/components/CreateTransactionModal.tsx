import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X } from 'lucide-react'
import Dropdown from '@/components/Dropdown'
import { useAccounts } from '@/api/accounts'
import { useCategories, type Category } from '@/api/categories'
import { useMerchants, useCreateMerchant } from '@/api/merchants'
import { useCurrencies } from '@/api/currency'
import { useCreateTransaction, type CreateTransactionPayload } from '@/api/transactions'
import { ApiError } from '@/api/auth'

/* ── Constants ── */

const EASE = [0.25, 0.1, 0.25, 1] as const

type Kind = 'expense' | 'income' | 'transfer'

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
]

const INITIAL_FORM = {
  kind: 'expense' as Kind,
  account_id: '',
  category_id: '',
  merchant_id: '',
  amount: '',
  currency: '',
  notes: '',
  date: '',
}

/* ── Helpers ── */

// date input expects "YYYY-MM-DD" in the user's local timezone.
function todayLocalString(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const KIND_LABELS: Record<string, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

// Build options for a single kind. Categories are flat, so each kind maps
// to a single section labelled with its kind name.
function buildOptionsForKind(categories: Category[], kind: string) {
  const kindLabel = KIND_LABELS[kind] ?? kind
  return categories
    .filter((c) => c.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ value: c.id, label: c.name, group: kindLabel }))
}

// Build the full category options list with the selected kind's options
// on top, followed by the other kinds in their natural order.
function buildCategoryOptions(categories: Category[], selectedKind: string) {
  const order = ['expense', 'income', 'transfer']
  const sorted = [selectedKind, ...order.filter((k) => k !== selectedKind)]
  return sorted.flatMap((kind) => buildOptionsForKind(categories, kind))
}

/* ── Validation ── */

interface FieldErrors {
  account_id?: string
  category_id?: string
  merchant_id?: string
  amount?: string
  currency?: string
}

function validate(form: typeof INITIAL_FORM): FieldErrors {
  const errors: FieldErrors = {}
  if (!form.account_id) errors.account_id = 'Select an account'
  if (!form.category_id) errors.category_id = 'Select a category'
  if (!form.merchant_id) errors.merchant_id = 'Select or create a merchant'
  if (!form.amount) errors.amount = 'Enter an amount'
  else {
    const n = parseFloat(form.amount)
    if (isNaN(n) || n <= 0) errors.amount = 'Amount must be greater than zero'
  }
  if (!form.currency) errors.currency = 'Select a currency'
  return errors
}

/* ── Component ── */

interface CreateTransactionModalProps {
  open: boolean
  onClose: () => void
}

export default function CreateTransactionModal({ open, onClose }: CreateTransactionModalProps) {
  const mutation = useCreateTransaction()
  const createMerchant = useCreateMerchant()
  const { data: accounts = [] } = useAccounts()
  const { data: categories = [] } = useCategories()
  const { data: merchants = [] } = useMerchants()
  const { data: currencies = [] } = useCurrencies()

  const [form, setForm] = useState(() => ({ ...INITIAL_FORM, date: todayLocalString() }))
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitError, setSubmitError] = useState('')

  const categoryById = useMemo(() => {
    const map = new Map<string, Category>()
    categories.forEach((c) => map.set(c.id, c))
    return map
  }, [categories])

  const accountOptions = useMemo(
    () => accounts.map((a) => ({ value: a.id, label: a.name })),
    [accounts],
  )
  const categoryOptions = useMemo(
    () => buildCategoryOptions(categories, form.kind),
    [categories, form.kind],
  )
  const merchantOptions = useMemo(
    () => merchants
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({ value: m.id, label: m.name })),
    [merchants],
  )
  const currencyOptions = useMemo(
    () => currencies.map((c) => ({ value: c.id, label: c.id })),
    [currencies],
  )

  const selectedCurrencySymbol = currencies.find((c) => c.id === form.currency)?.symbol ?? ''

  // Scroll lock + Escape close
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const clearError = (field: keyof FieldErrors) => {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }))
    setSubmitError('')
  }

  const handleKindChange = (kind: Kind) => {
    setForm((f) => ({ ...f, kind }))
  }

  const handleCategoryChange = (categoryId: string) => {
    const category = categoryById.get(categoryId)
    setForm((f) => ({
      ...f,
      category_id: categoryId,
      // Auto-switch the kind toggle to match the chosen category
      kind: (category?.kind as Kind) ?? f.kind,
    }))
    clearError('category_id')
  }

  const handleCreateMerchant = (name: string) => {
    createMerchant.mutate(
      { name },
      {
        onSuccess: (merchant) => {
          setForm((f) => ({ ...f, merchant_id: merchant.id }))
          clearError('merchant_id')
        },
        onError: (err) => {
          setSubmitError(err instanceof ApiError ? err.message : 'Could not create merchant.')
        },
      },
    )
  }

  const handleAccountChange = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId)
    setForm((f) => ({
      ...f,
      account_id: accountId,
      // Default the currency to the account's currency unless the user already changed it
      currency: f.currency || account?.currency || '',
    }))
    clearError('account_id')
  }

  const handleField = <K extends keyof typeof INITIAL_FORM>(field: K, value: typeof INITIAL_FORM[K]) => {
    setForm((f) => ({ ...f, [field]: value }))
    if (field in fieldErrors) clearError(field as keyof FieldErrors)
  }

  const handleBlur = (field: keyof FieldErrors) => {
    setTouched((t) => ({ ...t, [field]: true }))
    const errors = validate(form)
    setFieldErrors((prev) => ({ ...prev, [field]: errors[field] }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const errors = validate(form)
    setFieldErrors(errors)
    setTouched({ account_id: true, category_id: true, merchant_id: true, amount: true, currency: true })
    if (Object.keys(errors).length > 0) return

    // Convert major units (e.g. dollars) → minor units (e.g. cents)
    const selectedCurrency = currencies.find((c) => c.id === form.currency)
    const minorMultiplier = Math.pow(10, selectedCurrency?.minor_unit_exponent ?? 2)
    const magnitude = Math.round(parseFloat(form.amount) * minorMultiplier)
    // Expense and transfer outflows store as negative; income stores as positive.
    const signedAmount = form.kind === 'income' ? magnitude : -magnitude

    // Always store at 00:00 local time on the chosen date
    const [yr, mo, day] = form.date.split('-').map(Number)
    const ts = new Date(yr, mo - 1, day).toISOString()

    const payload: CreateTransactionPayload = {
      account_id: form.account_id,
      ts,
      category_id: form.category_id,
      merchant_id: form.merchant_id,
      amount: signedAmount,
      currency: form.currency,
      notes: form.notes.trim() || null,
    }

    mutation.mutate(payload, {
      onSuccess: () => onClose(),
      onError: (err) => {
        setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      },
    })
  }

  const showError = (field: keyof FieldErrors) => touched[field] && fieldErrors[field]

  return (
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
              aria-labelledby="create-txn-title"
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
                  id="create-txn-title"
                  className="font-serif text-3xl font-light tracking-tight"
                >
                  Add Transaction
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
                {/* Kind pills */}
                <div className="flex gap-2">
                  {KIND_OPTIONS.map((opt) => {
                    const selected = form.kind === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleKindChange(opt.value)}
                        className="flex-1 rounded-lg py-2 text-sm font-medium transition-colors duration-150"
                        style={{
                          background: selected ? 'var(--app-accent-soft)' : 'transparent',
                          color: selected ? 'var(--app-accent)' : 'var(--app-text-muted)',
                          border: `1px solid ${selected ? 'var(--app-accent-border)' : 'var(--app-border)'}`,
                        }}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>

                {/* Account */}
                <div>
                  <label className="app-label block mb-1.5">Account</label>
                  <Dropdown
                    options={accountOptions}
                    value={form.account_id}
                    onChange={handleAccountChange}
                    placeholder={accounts.length === 0 ? 'No accounts yet' : 'Select account...'}
                    searchable
                    searchPlaceholder="Search accounts..."
                  />
                  <AnimatePresence>
                    {showError('account_id') && (
                      <motion.p
                        className="mt-1 text-xs"
                        style={{ color: 'var(--app-negative)' }}
                        initial={{ opacity: 0, x: 4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 4 }}
                        transition={{ duration: 0.15 }}
                      >
                        {fieldErrors.account_id}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                {/* Category */}
                <div>
                  <label className="app-label block mb-1.5">Category</label>
                  <Dropdown
                    options={categoryOptions}
                    value={form.category_id}
                    onChange={handleCategoryChange}
                    placeholder="Select category..."
                    searchable
                    searchPlaceholder="Search categories..."
                  />
                  <AnimatePresence>
                    {showError('category_id') && (
                      <motion.p
                        className="mt-1 text-xs"
                        style={{ color: 'var(--app-negative)' }}
                        initial={{ opacity: 0, x: 4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 4 }}
                        transition={{ duration: 0.15 }}
                      >
                        {fieldErrors.category_id}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                {/* Merchant */}
                <div>
                  <label className="app-label block mb-1.5">Merchant</label>
                  <Dropdown
                    options={merchantOptions}
                    value={form.merchant_id}
                    onChange={(v) => {
                      handleField('merchant_id', v)
                    }}
                    placeholder="Select or type to create..."
                    searchable
                    searchPlaceholder="Search merchants..."
                    onCreateNew={handleCreateMerchant}
                  />
                  <AnimatePresence>
                    {showError('merchant_id') && (
                      <motion.p
                        className="mt-1 text-xs"
                        style={{ color: 'var(--app-negative)' }}
                        initial={{ opacity: 0, x: 4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 4 }}
                        transition={{ duration: 0.15 }}
                      >
                        {fieldErrors.merchant_id}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                {/* Amount + Currency */}
                <div className="grid grid-cols-[1fr_180px] gap-3">
                  <div>
                    <label htmlFor="txn-amount" className="app-label block mb-1.5">Amount</label>
                    <div className="relative">
                      {selectedCurrencySymbol && (
                        <span
                          className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
                          style={{
                            color: 'var(--app-text-subtle)',
                            fontSize: '0.9375rem',
                            lineHeight: 1,
                          }}
                          aria-hidden
                        >
                          {selectedCurrencySymbol}
                        </span>
                      )}
                      <input
                        id="txn-amount"
                        type="text"
                        inputMode="decimal"
                        className={`app-input w-full ${selectedCurrencySymbol ? 'pl-8' : ''} ${showError('amount') ? 'app-input-error' : ''}`}
                        placeholder="0.00"
                        value={form.amount}
                        onChange={(e) => {
                          // Allow only digits and a single decimal point
                          let sanitized = e.target.value.replace(/[^\d.]/g, '')
                          const parts = sanitized.split('.')
                          if (parts.length > 1) sanitized = `${parts[0]}.${parts.slice(1).join('')}`
                          // Prepend leading zero when the user starts with "."
                          if (sanitized.startsWith('.')) sanitized = `0${sanitized}`
                          handleField('amount', sanitized)
                        }}
                        onBlur={() => handleBlur('amount')}
                      />
                    </div>
                    <AnimatePresence>
                      {showError('amount') && (
                        <motion.p
                          className="mt-1 text-xs"
                          style={{ color: 'var(--app-negative)' }}
                          initial={{ opacity: 0, x: 4 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 4 }}
                          transition={{ duration: 0.15 }}
                        >
                          {fieldErrors.amount}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                  <div>
                    <label className="app-label block mb-1.5">Currency</label>
                    <Dropdown
                      options={currencyOptions}
                      value={form.currency}
                      onChange={(v) => handleField('currency', v)}
                      placeholder={currencies.length === 0 ? 'Loading…' : 'Select…'}
                      searchable
                      searchPlaceholder="Search currencies..."
                    />
                  </div>
                </div>

                {/* Date */}
                <div>
                  <label htmlFor="txn-date" className="app-label block mb-1.5">Date</label>
                  <input
                    id="txn-date"
                    type="date"
                    className="app-input"
                    value={form.date}
                    onChange={(e) => handleField('date', e.target.value)}
                  />
                </div>

                {/* Notes */}
                <div>
                  <label htmlFor="txn-notes" className="app-label block mb-1.5">Notes</label>
                  <textarea
                    id="txn-notes"
                    className="app-input min-h-[4.5rem] resize-y"
                    placeholder="Optional"
                    value={form.notes}
                    onChange={(e) => handleField('notes', e.target.value)}
                    maxLength={500}
                  />
                </div>

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
                    {mutation.isPending ? <div className="app-spinner" /> : 'Add Transaction'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
