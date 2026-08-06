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
 * Reports whether the fields have to refuse input, which they do while the decimal places they would
 * be edited in are unknown, and while an applied bound cannot be shown
 *
 * @param filters - The applied bounds and the currency their minor units belong to
 * @param currencies - The currency table, which is empty until it downloads
 * @param amountCurrency - The currency the fields edit in, which is the one a typed bound is stored
 * through and is not necessarily the one an applied bound was stored through
 */
export function isAmountRangeLocked(
  filters: AppliedAmountRange,
  currencies: Currency[],
  amountCurrency: string,
): boolean {
  return findCurrencyExponent(currencies, amountCurrency) === null
    || isAppliedRangeWaitingOnCurrency(filters, currencies)
}

/**
 * Reports whether an applied bound exists that the fields cannot show yet, which is the only case
 * with anything to fill in once the currency table arrives
 *
 * @param filters - The applied bounds and the currency their minor units belong to
 * @param currencies - The currency table, which is empty until it downloads
 */
export function isAppliedRangeWaitingOnCurrency(
  filters: AppliedAmountRange,
  currencies: Currency[],
): boolean {
  const hasBound = filters.min_amount !== undefined || filters.max_amount !== undefined

  return hasBound && findAmountRangeDraft(filters, currencies) === null
}

/**
 * Converts the applied bounds into the text the fields hold, returning null when no currency was
 * applied with them or when its decimal places are unknown
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
 * A locked range is one whose decimal places are unknown, so converting what the fields hold would
 * scale it by the two-place fallback, and a locked range that is blank would clear a bound the user
 * was never shown. The applied currency is handed back with the applied bounds, since bounds and the
 * minor units they are counted in only mean anything together
 *
 * @param amount - The minimum and maximum as the fields hold them
 * @param amountCurrency - The currency the fields edit in
 * @param exponent - Decimal places of that currency
 * @param isLocked - Whether the fields are refusing input, which is what makes the draft unusable
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
