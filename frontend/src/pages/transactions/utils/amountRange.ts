import { findCurrencyExponent, fromMinorUnits, toMinorUnits } from '@/utils/moneyInput'
import type { Currency } from '@/api/currency'
import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'

/** The minimum and maximum as the fields hold them, in the plain format a money field takes */
export type AmountDraft = { min: string; max: string }

/** The applied bounds and the currency their minor units belong to */
type AppliedAmountRange = Pick<TransactionListFilters, 'min_amount' | 'max_amount' | 'amount_currency'>

/**
 * Reports whether the amount filter's bounds exclude each other, which no transaction can satisfy
 *
 * Both bounds are converted to the stored minor units first, so the values compared are the ones
 * the list endpoint would receive rather than the typed text. A bound left blank, or holding text
 * naming no amount, cannot cross the other
 *
 * @param amount - The minimum and maximum as the fields hold them
 * @param exponent - Decimal places of the currency the range matches in
 */
export function isAmountRangeCrossed(amount: AmountDraft, exponent: number): boolean {
  const min = toMinorUnits(amount.min, exponent)
  const max = toMinorUnits(amount.max, exponent)

  return min !== null && max !== null && min > max
}

/**
 * Reports whether the amount range can be shown or edited at all, which it cannot while the decimal
 * places of the currency it matches in are unknown
 *
 * @param currencies - The currency table, which is empty until it downloads
 * @param amountCurrency - The currency the range matches in
 */
export function isAmountRangeLocked(currencies: Currency[], amountCurrency: string): boolean {
  return findCurrencyExponent(currencies, amountCurrency) === null
}

/**
 * Converts the applied bounds into the text the fields hold, or returns null when the decimal places
 * of the currency they were applied in are unknown
 *
 * A stored bound can only be turned into text through the real decimal places, so a currency the
 * table does not carry yields nothing rather than an amount scaled by the two-place fallback
 *
 * @param filters - The applied bounds and the currency their minor units belong to
 * @param currencies - The currency table, which is empty until it downloads
 */
export function findAmountRangeDraft(filters: AppliedAmountRange, currencies: Currency[]): AmountDraft | null {
  const exponent = findCurrencyExponent(currencies, filters.amount_currency ?? '')
  if (exponent === null) return null

  return {
    min: fromMinorUnits(filters.min_amount ?? null, exponent),
    max: fromMinorUnits(filters.max_amount ?? null, exponent),
  }
}

/**
 * Builds the amount part of the applied filters from the draft, handing back the bounds already
 * applied while the range is locked
 *
 * The fields are blank for as long as they are locked, so converting them would clear a bound the
 * user was never shown. Their currency is handed back with them, since bounds and the minor units
 * they are counted in only mean anything together
 *
 * @param amount - The minimum and maximum as the fields hold them
 * @param amountCurrency - The currency the range matches in
 * @param exponent - Decimal places of that currency
 * @param isLocked - Whether the range is locked, which is what makes the fields blank
 * @param filters - The applied bounds, kept as they are while locked
 */
export function buildAmountFilterPatch({
  amount,
  amountCurrency,
  exponent,
  isLocked,
  filters,
}: {
  amount: AmountDraft
  amountCurrency: string
  exponent: number
  isLocked: boolean
  filters: AppliedAmountRange
}): AppliedAmountRange {
  if (isLocked) {
    return {
      min_amount: filters.min_amount,
      max_amount: filters.max_amount,
      amount_currency: filters.amount_currency,
    }
  }

  // toMinorUnits returns null rather than undefined for a blank amount, which the applied filters
  // keep optional instead
  const toMinor = (value: string) => toMinorUnits(value, exponent) ?? undefined
  const hasAmount = Boolean(amount.min.trim() || amount.max.trim())

  return {
    min_amount: toMinor(amount.min),
    max_amount: toMinor(amount.max),
    amount_currency: hasAmount ? amountCurrency : undefined,
  }
}
