import type { TransactionBankSource } from '@/api/bank-sync'
import type { Currency } from '@/api/currency'
import { formatDateLabel } from '@/utils/date'
import { formatMovedAmount } from '@/utils/formatCurrency'

/** The bank's value under each editable field, as its caption reads it, or null where no caption shows */
export type BankValueCaptions = {
  date: string | null
  amount: string | null
}

/**
 * Reads the bank's latest value for each field the server counts as edited, so an unedited field shows
 * no caption, even one the user changed and changed back by hand
 *
 * An amount the bank sent with more decimal places than the currency holds has no stored value to
 * restore, so the amount shows no caption, though the server counts it as edited
 *
 * @param source - The transaction's bank source, null for a transaction entered by hand
 * @param currency - The transaction's currency, which the bank's amount is in
 */
export function getBankValueCaptions(
  source: TransactionBankSource | null | undefined,
  currency: string,
  currencies: Currency[],
): BankValueCaptions {
  if (!source) return { date: null, amount: null }

  const { date, amount } = source.bank_values
  return {
    date: source.edited_fields.includes('date') ? formatDateLabel(date) : null,
    amount: source.edited_fields.includes('amount') && amount !== null
      ? formatMovedAmount(amount, currency, currencies)
      : null,
  }
}
