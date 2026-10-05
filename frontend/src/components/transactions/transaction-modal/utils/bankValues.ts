import type { EditableBankField, TransactionBankSource } from '@/api/bank-sync'
import type { Currency } from '@/api/currency'
import { formatDateLabel } from '@/utils/date'
import { formatExactMovedAmount, formatMovedAmount } from '@/utils/formatCurrency'

// The text an amount exactly as the bank sent it can take, as the server checks it
const RAW_AMOUNT_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/

/** The bank's value under an edited field, and whether it can be put back on the transaction */
export type BankValueCaption = {
  value: string
  restorable: boolean
}

/** The caption under each editable field, or null where none shows */
export type BankValueCaptions = Record<EditableBankField, BankValueCaption | null>

/**
 * Reads the bank's latest value for each field the server counts as edited, so an unedited field shows
 * no caption, even one the user changed and changed back by hand
 *
 * An amount the bank sent with more decimal places than the currency holds shows exactly as sent,
 * with every place, but can't be restored, since the ledger can't store it. Its caption still
 * explains the edited mark on the transaction's row
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

  const { date, amount, raw_amount: rawAmount } = source.bank_values
  const amountCaption = (): BankValueCaption | null => {
    if (!source.edited_fields.includes('amount')) return null
    if (amount === null) return { value: formatRawAmount(rawAmount ?? '', currency), restorable: false }
    return { value: formatMovedAmount(amount, currency, currencies), restorable: true }
  }
  return {
    date: source.edited_fields.includes('date') ? { value: formatDateLabel(date), restorable: true } : null,
    amount: amountCaption(),
  }
}

/**
 * Formats an amount exactly as the bank sent it, with every decimal place it carried, signed as any
 * amount that moved is. Text the server would never send is shown as it came
 */
function formatRawAmount(rawAmount: string, currency: string): string {
  const match = RAW_AMOUNT_PATTERN.exec(rawAmount)
  if (!match) return rawAmount
  const [, sign, whole, fraction = ''] = match
  return formatExactMovedAmount(BigInt(`${whole}${fraction}`) * (sign === '-' ? -1n : 1n), currency, fraction.length)
}
