import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { Currency } from '@/api/currency'
import type { Transaction } from '@/api/transactions'
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
  // Whether this opening seeded the amount blank, which is the only case with anything to restore
  const seededWithoutExponentRef = useRef(isAmountLocked)

  // Re-armed on each opening, since the form is seeded again then and may again be seeded before
  // the table lands. Only the opening matters: re-running as the table arrives would re-arm the
  // flag the fill-in below has just cleared, and overwrite whatever was typed since
  useEffect(() => {
    if (!open) return

    seededWithoutExponentRef.current = isAmountLocked
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!transaction || !seededWithoutExponentRef.current) return

    const amount = findAmountInputString(transaction.amount, currencies, transaction.currency)
    if (amount === null) return

    seededWithoutExponentRef.current = false
    setForm((current) => ({ ...current, amount }))
  }, [transaction, currencies, setForm])
}
