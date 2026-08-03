import type {
  CreateTransactionPayload,
  Transaction,
  TransferCounterpartyScope,
  UpdateTransactionPayload,
} from '@/api/transactions'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import {
  amountInputToMinorUnits,
  applyTransactionDirection,
} from '@/pages/transactions/components/transaction-modal/utils/money'
import type {
  TransactionDirection,
  TransactionFormValues,
} from '@/pages/transactions/components/transaction-modal/types'

/**
 * Splits the form's single counterparty-account selection into the API's id-and-scope pair
 *
 * Empty means unanswered, so both come back null. The outside sentinel means the money left the
 * tracked accounts, sent as a scope with no id. Anything else is a tracked account id
 */
function splitCounterpartyAccountSelection(counterpartyAccountId: string): {
  counterparty_account_id: string | null
  counterparty_account_scope: TransferCounterpartyScope | null
} {
  if (!counterpartyAccountId) return { counterparty_account_id: null, counterparty_account_scope: null }
  if (counterpartyAccountId === OUTSIDE_ACCOUNT_VALUE) return { counterparty_account_id: null, counterparty_account_scope: 'outside' }
  return { counterparty_account_id: counterpartyAccountId, counterparty_account_scope: 'tracked' }
}

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
  // Every other category rejects the pair outright, so it is only ever sent for a transfer
  if (form.kind === 'transfer') Object.assign(payload, splitCounterpartyAccountSelection(form.counterparty_account_id))
  return payload
}

/**
 * Returns what each leg of a symmetric transfer does, the recorded account's first
 *
 * The direction says what happens to the recorded account, so the other leg is always its opposite.
 * A failed leg is reported to the user by this wording and they re-enter it by hand, so having the
 * two the wrong way round would tell them to enter it backwards
 */
export function getSymmetricTransferLegKinds(
  direction: TransactionDirection,
): [TransactionDirection, TransactionDirection] {
  return direction === 'debit' ? ['debit', 'credit'] : ['credit', 'debit']
}

/**
 * Builds the two payloads for a symmetric transfer
 *
 * The direction decides which account loses the money and which gains it, and the magnitude is the
 * same on both. Both legs share every other field so they read as the same movement in two
 * accounts. The two rows stay independent on the backend, matching how the app already records
 * transfers
 */
export function buildSymmetricTransferPayloads(
  form: TransactionFormValues,
  selectedCurrencyExponent: number,
): [CreateTransactionPayload, CreateTransactionPayload] {
  const magnitude = amountInputToMinorUnits(form.amount, selectedCurrencyExponent) ?? 0
  const shared = {
    dt: form.date,
    category_id: form.category_id,
    merchant_id: form.merchant_id,
    currency: form.currency,
    notes: form.notes.trim() || null,
  }
  // The direction says what happens to the account the transaction is recorded in, so it decides
  // which of the two legs is the negative one rather than the recorded account always being it
  const recordedAmount = form.direction === 'debit' ? -magnitude : magnitude

  // One field serves as both the receiving account and the recorded one, so the two always agree
  // here. Ticking the checkbox takes the outside entry off the list and clears it if it was chosen,
  // so the split below only ever produces a tracked account
  const fromPayload: CreateTransactionPayload = {
    account_id: form.account_id,
    amount: recordedAmount,
    ...shared,
    ...splitCounterpartyAccountSelection(form.counterparty_account_id),
  }
  // The second leg's counterparty is not in question: it is always the originating account, a tracked account in the app
  const toPayload: CreateTransactionPayload = {
    account_id: form.counterparty_account_id,
    amount: -recordedAmount,
    counterparty_account_id: form.account_id,
    counterparty_account_scope: 'tracked',
    ...shared,
  }
  if (form.tag_ids.length > 0) {
    fromPayload.tag_ids = form.tag_ids
    toPayload.tag_ids = form.tag_ids
  }
  return [fromPayload, toPayload]
}

/**
 * Builds a minimal update patch so unchanged transaction fields are not sent back to the API
 */
export function buildUpdateTransactionPatch(
  form: TransactionFormValues,
  transaction: Transaction,
  selectedCurrencyExponent: number | null,
): UpdateTransactionPayload | null {
  const notes = form.notes.trim() || null
  const patch: UpdateTransactionPayload = {}

  if (form.account_id !== transaction.account_id) patch.account_id = form.account_id
  if (form.category_id !== transaction.category_id) patch.category_id = form.category_id
  if (form.merchant_id !== (transaction.merchant_id ?? '')) patch.merchant_id = form.merchant_id || null
  // Left out entirely when the currency's decimal places are unknown. The field is blank in that state,
  // and a blank converts to zero, so sending it would wipe an amount the user was never shown
  if (selectedCurrencyExponent !== null) {
    const magnitude = amountInputToMinorUnits(form.amount, selectedCurrencyExponent) ?? 0
    const signedAmount = applyTransactionDirection(magnitude, form.direction)
    if (signedAmount !== transaction.amount) patch.amount = signedAmount
  }
  if (form.date !== transaction.dt) patch.dt = form.date
  if (notes !== (transaction.notes ?? null)) patch.notes = notes
  if (!sameStringSet(form.tag_ids, transaction.tag_ids)) patch.tag_ids = form.tag_ids

  // Left out entirely once the category leaves transfer, since the backend clears the stored
  // answer itself when the category it ends up with no longer records a counterparty account
  if (form.kind === 'transfer') {
    const { counterparty_account_id, counterparty_account_scope } = splitCounterpartyAccountSelection(form.counterparty_account_id)
    const storedScope = transaction.counterparty_account_scope ?? null
    const storedId = transaction.counterparty_account_id ?? null
    if (counterparty_account_id !== storedId || counterparty_account_scope !== storedScope) {
      patch.counterparty_account_id = counterparty_account_id
      patch.counterparty_account_scope = counterparty_account_scope
    }
  }

  return Object.keys(patch).length > 0 ? patch : null
}

function sameStringSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((value, index) => value === right[index])
}
