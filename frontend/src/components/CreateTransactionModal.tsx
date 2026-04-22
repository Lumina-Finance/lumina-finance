import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Check, Trash2, X } from 'lucide-react'
import Dropdown from '@/components/Dropdown'
import { useAccounts } from '@/api/accounts'
import { useCategories, type Category } from '@/api/categories'
import { useMerchants, useCreateMerchant } from '@/api/merchants'
import { useCurrencies } from '@/api/currency'
import {
  useCreateTransaction,
  useDeleteTransaction,
  useUpdateTransaction,
  type CreateTransactionPayload,
  type Transaction,
  type UpdateTransactionPayload,
} from '@/api/transactions'
import { ApiError } from '@/api/auth'

/* ── Constants ── */

const EASE = [0.25, 0.1, 0.25, 1] as const

type Kind = 'expense' | 'income' | 'transfer'

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
]

// Transfers can go either way on a single account — pulling money out
// (e.g. paying a credit card from checking) or bringing it in (receiving a
// repayment, moving savings back). The sign on `amount` encodes this on the
// backend; the modal tracks it explicitly via `transfer_direction`.
type TransferDirection = 'in' | 'out'

const INITIAL_FORM = {
  kind: 'expense' as Kind,
  transfer_direction: 'out' as TransferDirection,
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

// Convert minor units (signed) to a fixed-decimal positive string for the amount input.
function amountToInputString(amountMinor: number, exponent: number): string {
  return (Math.abs(amountMinor) / Math.pow(10, exponent)).toFixed(exponent)
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
  /** When set, the modal opens in edit mode for this transaction. */
  transaction?: Transaction
  /** Pre-select this account in create mode (e.g., opened from an account page). */
  defaultAccountId?: string
}

export default function CreateTransactionModal({
  open,
  onClose,
  transaction,
  defaultAccountId,
}: CreateTransactionModalProps) {
  const editing = !!transaction
  const createMutation = useCreateTransaction()
  const updateMutation = useUpdateTransaction()
  const deleteMutation = useDeleteTransaction()
  const createMerchant = useCreateMerchant()
  const { data: accounts = [] } = useAccounts()
  const { data: categories = [] } = useCategories()
  const { data: merchants = [] } = useMerchants()
  const { data: currencies = [] } = useCurrencies()

  // Build the initial form from the existing transaction (edit) or sensible defaults (create).
  const initialForm = useMemo(() => {
    if (!transaction) {
      return {
        ...INITIAL_FORM,
        account_id: defaultAccountId ?? INITIAL_FORM.account_id,
        date: todayLocalString(),
      }
    }
    const category = categories.find((c) => c.id === transaction.category_id)
    const exp = currencies.find((c) => c.id === transaction.currency)?.minor_unit_exponent ?? 2
    return {
      kind: (category?.kind as Kind) ?? 'expense',
      // Recover direction from the stored sign so the toggle reflects reality.
      transfer_direction: (transaction.amount >= 0 ? 'in' : 'out') as TransferDirection,
      account_id: transaction.account_id,
      category_id: transaction.category_id,
      merchant_id: transaction.merchant_id ?? '',
      amount: amountToInputString(transaction.amount, exp),
      currency: transaction.currency,
      notes: transaction.notes ?? '',
      date: transaction.dt,
    }
  }, [transaction, categories, currencies, defaultAccountId])

  const [form, setForm] = useState(initialForm)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitError, setSubmitError] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const idleLabelRef = useRef<HTMLSpanElement>(null)
  const confirmLabelRef = useRef<HTMLSpanElement>(null)
  const [labelWidths, setLabelWidths] = useState<{ idle: number; confirm: number } | null>(null)

  // Measure both label widths once after mount so we can drive a smooth width transition.
  useLayoutEffect(() => {
    if (!editing) return
    if (idleLabelRef.current && confirmLabelRef.current) {
      setLabelWidths({
        idle: idleLabelRef.current.offsetWidth,
        confirm: confirmLabelRef.current.offsetWidth,
      })
    }
  }, [editing])

  // Cancel pending deletion if the user clicks anywhere outside the Delete button.
  useEffect(() => {
    if (!confirmingDelete) return
    const onPointer = (e: PointerEvent) => {
      if (deleteButtonRef.current && !deleteButtonRef.current.contains(e.target as Node)) {
        setConfirmingDelete(false)
      }
    }
    // defer to next tick so the click that armed confirmation doesn't immediately undo it
    const t = setTimeout(() => window.addEventListener('pointerdown', onPointer), 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [confirmingDelete])

  const submitMutation = editing ? updateMutation : createMutation
  const isPending = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending

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

    const selectedCurrency = currencies.find((c) => c.id === form.currency)
    const minorMultiplier = Math.pow(10, selectedCurrency?.minor_unit_exponent ?? 2)
    const magnitude = Math.round(parseFloat(form.amount) * minorMultiplier)
    // Sign comes from kind + (for transfers) direction. Income is always +;
    // expense is always −; transfers depend on which way money moved.
    const isInflow =
      form.kind === 'income' || (form.kind === 'transfer' && form.transfer_direction === 'in')
    const signedAmount = isInflow ? magnitude : -magnitude
    const notes = form.notes.trim() || null

    if (editing && transaction) {
      // Build a minimal patch from fields that actually changed
      const patch: UpdateTransactionPayload = {}
      if (form.account_id !== transaction.account_id) patch.account_id = form.account_id
      if (form.category_id !== transaction.category_id) patch.category_id = form.category_id
      if (form.merchant_id !== (transaction.merchant_id ?? '')) patch.merchant_id = form.merchant_id || null
      if (signedAmount !== transaction.amount) patch.amount = signedAmount
      if (form.date !== initialForm.date) patch.dt = form.date
      if (notes !== (transaction.notes ?? null)) patch.notes = notes

      if (Object.keys(patch).length === 0) {
        onClose()
        return
      }

      updateMutation.mutate(
        { id: transaction.id, patch },
        {
          onSuccess: () => onClose(),
          onError: (err) => {
            setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
          },
        },
      )
      return
    }

    const payload: CreateTransactionPayload = {
      account_id: form.account_id,
      dt: form.date,
      category_id: form.category_id,
      merchant_id: form.merchant_id,
      amount: signedAmount,
      currency: form.currency,
      notes,
    }

    createMutation.mutate(payload, {
      onSuccess: () => onClose(),
      onError: (err) => {
        setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      },
    })
  }

  const handleDelete = () => {
    if (!transaction) return
    deleteMutation.mutate(transaction.id, {
      onSuccess: () => onClose(),
      onError: (err) => {
        setConfirmingDelete(false)
        setSubmitError(err instanceof ApiError ? err.message : 'Could not delete transaction.')
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
                  {editing ? 'Edit Transaction' : 'Add Transaction'}
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
                {/* Kind pills — locked in edit mode (kind is derived from the chosen category) */}
                <div className="flex gap-2">
                  {KIND_OPTIONS.map((opt) => {
                    const selected = form.kind === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => !editing && handleKindChange(opt.value)}
                        disabled={editing}
                        aria-disabled={editing}
                        className="flex-1 rounded-lg py-2 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed"
                        style={{
                          background: selected ? 'var(--app-accent-soft)' : 'transparent',
                          color: selected ? 'var(--app-accent)' : 'var(--app-text-muted)',
                          border: `1px solid ${selected ? 'var(--app-accent-border)' : 'var(--app-border)'}`,
                          opacity: editing && !selected ? 0.4 : 1,
                        }}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>

                {/* Transfer direction — only meaningful when the transaction
                    is a transfer. Stays editable in edit mode so a mis-signed
                    transfer can be corrected without deleting the row. */}
                <AnimatePresence initial={false}>
                  {form.kind === 'transfer' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease: EASE }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div>
                        <label className="app-label block mb-1.5">Direction</label>
                        <div className="flex gap-2">
                          {([
                            { value: 'out', label: 'Money Out' },
                            { value: 'in', label: 'Money In' },
                          ] as const).map((opt) => {
                            const selected = form.transfer_direction === opt.value
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => handleField('transfer_direction', opt.value)}
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
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

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
                      disabled={editing}
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
                  className="flex items-center gap-3 pt-4"
                  style={{ borderTop: '1px solid var(--app-border)' }}
                >
                  {editing && (
                    <button
                      ref={deleteButtonRef}
                      type="button"
                      onClick={() => {
                        if (isPending) return
                        if (confirmingDelete) handleDelete()
                        else setConfirmingDelete(true)
                      }}
                      disabled={isPending}
                      className={`app-primary-button ${isPending && confirmingDelete ? 'app-primary-button-loading' : ''}`}
                      style={{
                        background: 'var(--app-negative)',
                        color: 'white',
                        boxShadow: '0 4px 20px color-mix(in srgb, var(--app-negative) 28%, transparent)',
                      }}
                    >
                      {isPending && confirmingDelete ? (
                        <div className="app-spinner" />
                      ) : (
                        <span
                          className="relative block"
                          style={{
                            width: labelWidths
                              ? `${confirmingDelete ? labelWidths.confirm : labelWidths.idle}px`
                              : 'auto',
                            height: '1.25rem',
                            transition: 'width 220ms cubic-bezier(0.25, 0.1, 0.25, 1)',
                          }}
                        >
                          {/* Hidden refs measure the natural width of each label once on mount */}
                          <span
                            ref={idleLabelRef}
                            className="invisible absolute inline-flex items-center gap-2 whitespace-nowrap"
                            aria-hidden
                          >
                            <Trash2 size={16} aria-hidden />
                            Delete
                          </span>
                          <span
                            ref={confirmLabelRef}
                            className="invisible absolute inline-flex items-center gap-2 whitespace-nowrap"
                            aria-hidden
                          >
                            <Check size={16} aria-hidden />
                            Yes, delete
                          </span>
                          {/* Visible labels stack and crossfade */}
                          <span
                            className="absolute inset-0 inline-flex items-center justify-center gap-2 whitespace-nowrap transition-opacity duration-150"
                            style={{ opacity: confirmingDelete ? 0 : 1 }}
                          >
                            <Trash2 size={16} aria-hidden />
                            Delete
                          </span>
                          <span
                            className="absolute inset-0 inline-flex items-center justify-center gap-2 whitespace-nowrap transition-opacity duration-150"
                            style={{ opacity: confirmingDelete ? 1 : 0 }}
                          >
                            <Check size={16} aria-hidden />
                            Yes, delete
                          </span>
                        </span>
                      )}
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-3">
                    <button
                      type="button"
                      className="app-secondary-button"
                      onClick={onClose}
                      disabled={isPending}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isPending}
                      className={`app-primary-button ${submitMutation.isPending ? 'app-primary-button-loading' : ''}`}
                    >
                      {submitMutation.isPending ? <div className="app-spinner" /> : editing ? 'Save' : 'Add Transaction'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
