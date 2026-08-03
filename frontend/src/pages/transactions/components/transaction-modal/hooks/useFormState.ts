import { useState, type Dispatch, type SetStateAction } from 'react'
import { getDefaultDirectionForKind } from '@/pages/transactions/components/transaction-modal/utils/categories'
import { getDirectionFromAmountInputSign } from '@/pages/transactions/components/transaction-modal/utils/money'
import { validateTransactionForm } from '@/pages/transactions/components/transaction-modal/utils/validation'
import type {
  TransactionFormFieldErrors,
  TransactionFormValues,
  TransactionModalKind,
} from '@/pages/transactions/components/transaction-modal/types'

interface TransactionFormState {
  form: TransactionFormValues
  setForm: Dispatch<SetStateAction<TransactionFormValues>>
  fieldErrors: TransactionFormFieldErrors
  setFieldErrors: Dispatch<SetStateAction<TransactionFormFieldErrors>>
  touched: Record<string, boolean>
  setTouched: Dispatch<SetStateAction<Record<string, boolean>>>
  submitError: string
  setSubmitError: Dispatch<SetStateAction<string>>
  submitErrorTitle: string
  setSubmitErrorTitle: Dispatch<SetStateAction<string>>
  directionHighlightKey: number
  clearError: (field: keyof TransactionFormFieldErrors) => void
  applyKindChange: (nextKind: TransactionModalKind, fields?: Partial<TransactionFormValues>) => void
  handleField: <K extends keyof TransactionFormValues>(field: K, value: TransactionFormValues[K]) => void
  handleAmountChange: (value: string, typed?: string) => void
  handleBlur: (field: keyof TransactionFormFieldErrors) => void
  showError: (field: keyof TransactionFormFieldErrors) => string | false | undefined
}

/**
 * Owns the transaction form values, validation errors, and submit-error banner, including the
 * shared kind-change routine that keeps the direction toggle in sync
 */
export function useTransactionFormState(initialForm: TransactionFormValues): TransactionFormState {
  const [form, setForm] = useState(initialForm)
  const [fieldErrors, setFieldErrors] = useState<TransactionFormFieldErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitError, setSubmitError] = useState('')

  // A heading shown above the submit error when only one leg of a symmetric transfer fails
  const [submitErrorTitle, setSubmitErrorTitle] = useState('')
  const [directionHighlightKey, setDirectionHighlightKey] = useState(0)

  const clearError = (field: keyof TransactionFormFieldErrors) => {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }))
    setSubmitError('')
    setSubmitErrorTitle('')
  }

  // Shared by every field whose change can imply a different transaction kind (the kind toggle
  // itself, category selection, and merchant selection), so the direction toggle and its
  // highlight animation stay consistent no matter which field triggered the switch
  const applyKindChange = (nextKind: TransactionModalKind, fields?: Partial<TransactionFormValues>) => {
    const kindChanged = nextKind !== form.kind
    setForm((f) => ({
      ...f,
      // A non-transfer kind has no counterparty to record, so a pending answer from a previous
      // transfer selection is dropped rather than lingering unseen. The checkbox goes with it,
      // since leaving it set would arm a second transaction on the next transfer without the user
      // ticking it again
      ...(nextKind === 'transfer' ? {} : { counterparty_account_id: '', symmetric_transfer: false }),
      ...fields,
      kind: nextKind,
      direction: nextKind === f.kind ? f.direction : getDefaultDirectionForKind(nextKind),
    }))
    if (kindChanged) setDirectionHighlightKey((key) => key + 1)
  }

  const handleField = <K extends keyof TransactionFormValues>(field: K, value: TransactionFormValues[K]) => {
    setForm((f) => ({ ...f, [field]: value }))
    if (field in fieldErrors) clearError(field as keyof TransactionFormFieldErrors)
  }

  const handleAmountChange = (value: string, typed?: string) => {
    // The field settling on blur re-fires onChange with only the canonical value, so a missing
    // typed argument means there is no fresh sign to read and the direction stays put
    const signDirection = typed === undefined ? null : getDirectionFromAmountInputSign(typed)
    setForm((f) => ({
      ...f,
      amount: value,
      direction: signDirection ?? f.direction,
    }))
    if (signDirection && signDirection !== form.direction) setDirectionHighlightKey((key) => key + 1)
    if ('amount' in fieldErrors) clearError('amount')
  }

  const handleBlur = (field: keyof TransactionFormFieldErrors) => {
    setTouched((t) => ({ ...t, [field]: true }))
    const errors = validateTransactionForm(form)
    setFieldErrors((prev) => ({ ...prev, [field]: errors[field] }))
  }

  const showError = (field: keyof TransactionFormFieldErrors) => touched[field] && fieldErrors[field]

  return {
    form,
    setForm,
    fieldErrors,
    setFieldErrors,
    touched,
    setTouched,
    submitError,
    setSubmitError,
    submitErrorTitle,
    setSubmitErrorTitle,
    directionHighlightKey,
    clearError,
    applyKindChange,
    handleField,
    handleAmountChange,
    handleBlur,
    showError,
  }
}
