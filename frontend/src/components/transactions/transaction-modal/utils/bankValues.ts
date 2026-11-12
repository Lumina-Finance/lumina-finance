import type { EditableBankField, TransactionBankSource } from '@/api/bank-sync'
import type { Currency } from '@/api/currency'
import { formatRawAmount } from '@/components/transactions/utils/bankReview'
import { formatDateLabel } from '@/utils/date'
import { formatMovedCurrency } from '@/utils/formatCurrency'

/** The bank's value under an edited field, and why it can't be put back on the transaction, if it can't */
export type BankValueCaption = {
  value: string
  unavailableReason: string | null
}

/** The caption under each editable field, or null where none shows */
type BankValueCaptions = Record<EditableBankField, BankValueCaption | null>

/**
 * Reads the bank's latest value for each field the server counts as edited, so an unedited field shows
 * no caption, even one the user changed and changed back by hand
 *
 * An amount the bank sent with more decimal places than the currency holds shows exactly as sent,
 * with every place, but can't be restored, since the ledger can't store it. Its caption still
 * explains the edited mark on the transaction's row, and gives the reason the server refuses that
 * restore with, for the action to show greyed out
 *
 * @param source - The transaction's bank source, null for a transaction entered by hand
 * @param currency - The transaction's currency. The bank's amount is in it
 */
export function getBankValueCaptions(
  source: TransactionBankSource | null | undefined,
  currency: string,
  currencies: Currency[],
): BankValueCaptions {
  if (!source) return { date: null, amount: null }

  const { date, amount, raw_amount: rawAmount } = source.bank_values
  const amountCaption = (): BankValueCaption | null => {
    if (!source.edited_fields.includes('amount')) return null
    if (amount === null) {
      return {
        value: formatRawAmount(rawAmount ?? '', currency).text,
        unavailableReason: getUnstorableAmountReason(currency),
      }
    }
    return { value: formatMovedCurrency(amount, currency, currencies), unavailableReason: null }
  }
  return {
    date: source.edited_fields.includes('date') ? { value: formatDateLabel(date), unavailableReason: null } : null,
    amount: amountCaption(),
  }
}

/**
 * Why a bank item opens with its amount empty, said under the field: the bank sent more decimal places
 * than the currency holds, which the item's card shows exactly as sent, so the user enters the amount
 *
 * @param bank - The item's bank values, its amount null when the currency can't hold it
 * @param currency - The account's currency, which the bank's amount is in
 */
export function getReviewAmountNote(bank: { amount: number | null }, currency: string): string | null {
  if (bank.amount !== null) return null
  return `The bank's amount has more decimal places than ${currency} allows, so please enter the amount by hand`
}

/** Why the bank's amount can't be restored, in the words the server refuses that restore with */
function getUnstorableAmountReason(currency: string): string {
  return `The bank's amount has more decimal places than ${currency} allows, so the app can't restore the amount`
}
