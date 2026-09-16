import type { Dispatch, SetStateAction } from 'react'
import type { Currency } from '@/api/currency'
import type { Transaction } from '@/api/transactions'
import { useRestoreOnceWhenReady } from '@/hooks/useRestoreOnceWhenReady'
import { findAmountInputString } from '@/pages/transactions/components/transaction-modal/utils/money'
import type { TransactionFormValues } from '@/pages/transactions/components/transaction-modal/types'

interface RestoreLockedAmountOptions {
  open: boolean
  transaction: Transaction | undefined
  currencies: Currency[]
  isAmountLocked: boolean
  setForm: Dispatch<SetStateAction<TransactionFormValues>>
}

/**
 * Fills the amount box in when the transaction's currency becomes known, for a modal that opened
 * before the currency table arrived and therefore seeded the box blank
 *
 * Without this the box unlocks empty over a transaction that has an amount, and the form reads that
 * as the user having cleared it, so validation demands an amount and the save is refused. The field
 * is disabled for the whole time it is locked, so filling it in cannot overwrite anything typed
 */
export function useRestoreLockedAmount({
  open,
  transaction,
  currencies,
  isAmountLocked,
  setForm,
}: RestoreLockedAmountOptions): void {
  const readyAmount = transaction
    ? findAmountInputString(transaction.amount, currencies, transaction.currency)
    : null

  useRestoreOnceWhenReady({
    open,
    shouldRestore: isAmountLocked,
    readyValue: readyAmount,
    restore: (amount) => setForm((current) => ({ ...current, amount })),
  })
}
