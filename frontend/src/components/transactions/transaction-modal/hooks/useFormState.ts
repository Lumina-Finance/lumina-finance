import { useState, type Dispatch, type SetStateAction } from 'react'
import { getFormAfterKindChange } from '@/components/transactions/transaction-modal/utils/formTransitions'
import { getDirectionFromAmountInputSign } from '@/components/transactions/transaction-modal/utils/money'
import type {
  TransactionFormValues,
  TransactionModalKind,
} from '@/components/transactions/transaction-modal/types'

interface TransactionFormState {
  form: TransactionFormValues
  setForm: Dispatch<SetStateAction<TransactionFormValues>>
  submitError: string
  setSubmitError: Dispatch<SetStateAction<string>>
  submitErrorTitle: string
  setSubmitErrorTitle: Dispatch<SetStateAction<string>>
  directionHighlightKey: number
  clearSubmitError: () => void
  applyKindChange: (nextKind: TransactionModalKind, fields?: Partial<TransactionFormValues>) => void
  handleField: <K extends keyof TransactionFormValues>(field: K, value: TransactionFormValues[K]) => void
  handleAmountChange: (value: string, typed?: string) => void
}

/**
 * Owns the transaction form values and the submit-error banner, including the shared kind-change
 * routine that keeps the direction toggle in sync
 */
export function useTransactionFormState(initialForm: TransactionFormValues): TransactionFormState {
  const [form, setForm] = useState(initialForm)
  const [submitError, setSubmitError] = useState('')

  // A heading shown above the submit error when only one leg of a symmetric transfer fails
  const [submitErrorTitle, setSubmitErrorTitle] = useState('')
  const [directionHighlightKey, setDirectionHighlightKey] = useState(0)

  // A change to the form may fix what an earlier save failed on
  const clearSubmitError = () => {
    setSubmitError('')
    setSubmitErrorTitle('')
  }

  // Shared by every field whose change can imply a different transaction kind (the kind toggle
  // itself, category selection, and merchant selection), so the direction toggle and its
  // highlight animation stay consistent no matter which field triggered the switch
  const applyKindChange = (nextKind: TransactionModalKind, fields?: Partial<TransactionFormValues>) => {
    const kindChanged = nextKind !== form.kind
    setForm((f) => getFormAfterKindChange(f, nextKind, fields))
    if (kindChanged) setDirectionHighlightKey((key) => key + 1)
  }

  const handleField = <K extends keyof TransactionFormValues>(field: K, value: TransactionFormValues[K]) => {
    setForm((f) => ({ ...f, [field]: value }))
    clearSubmitError()
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
    if (typed !== undefined) clearSubmitError()
  }

  return {
    form,
    setForm,
    submitError,
    setSubmitError,
    submitErrorTitle,
    setSubmitErrorTitle,
    directionHighlightKey,
    clearSubmitError,
    applyKindChange,
    handleField,
    handleAmountChange,
  }
}
