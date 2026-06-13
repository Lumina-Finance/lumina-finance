import type {
  CreateTransactionPayload,
  Transaction,
  UpdateTransactionPayload,
} from '@/api/transactions'
import {
  amountInputToMinorUnits,
  applyTransactionDirection,
} from '@/pages/transactions/components/transaction-modal/utils/money'
import type { TransactionFormValues } from '@/pages/transactions/components/transaction-modal/types'

/**
 * Builds the create payload after the form has passed validation
 */
export function buildCreateTransactionPayload(
  form: TransactionFormValues,
  selectedCurrencyExponent: number,
): CreateTransactionPayload {
  const magnitude = amountInputToMinorUnits(form.amount, selectedCurrencyExponent) ?? 0
  const payload: CreateTransactionPayload = {
    account_id: form.account_id,
    dt: form.date,
    category_id: form.category_id,
    merchant_id: form.merchant_id,
    amount: applyTransactionDirection(magnitude, form.direction),
    currency: form.currency,
    notes: form.notes.trim() || null,
  }
  if (form.tag_ids.length > 0) payload.tag_ids = form.tag_ids
  return payload
}

/**
 * Builds a minimal update patch so unchanged transaction fields are not sent back to the API
 */
export function buildUpdateTransactionPatch(
  form: TransactionFormValues,
  transaction: Transaction,
  selectedCurrencyExponent: number,
): UpdateTransactionPayload | null {
  const magnitude = amountInputToMinorUnits(form.amount, selectedCurrencyExponent) ?? 0
  const signedAmount = applyTransactionDirection(magnitude, form.direction)
  const notes = form.notes.trim() || null
  const patch: UpdateTransactionPayload = {}

  if (form.account_id !== transaction.account_id) patch.account_id = form.account_id
  if (form.category_id !== transaction.category_id) patch.category_id = form.category_id
  if (form.merchant_id !== (transaction.merchant_id ?? '')) patch.merchant_id = form.merchant_id || null
  if (signedAmount !== transaction.amount) patch.amount = signedAmount
  if (form.date !== transaction.dt) patch.dt = form.date
  if (notes !== (transaction.notes ?? null)) patch.notes = notes
  if (!sameStringSet(form.tag_ids, transaction.tag_ids)) patch.tag_ids = form.tag_ids

  return Object.keys(patch).length > 0 ? patch : null
}

function sameStringSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((value, index) => value === right[index])
}
