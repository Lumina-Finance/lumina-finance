import type { Currency } from '@/api/currency'
import type { TransactionAmountPresentation } from '@/components/transactions/Row'
import { formatExactMovedAmount } from '@/utils/formatCurrency'
import { getAmountSign } from '@/utils/negativeAmount'
import { DEFAULT_MINOR_UNIT_EXPONENT, findCurrencyExponent } from '@/utils/moneyInput'

/**
 * Formats exact preview minor units without narrowing their digits to a floating-point number, at
 * the currency's own decimal places
 */
export function formatPreviewMoney(
  amount: bigint,
  currency: string,
  currencies: Currency[],
): TransactionAmountPresentation {
  const exponent =
    findCurrencyExponent(currencies, currency) ??
    new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ??
    DEFAULT_MINOR_UNIT_EXPONENT
  return { text: formatExactMovedAmount(amount, currency, exponent), sign: getAmountSign(amount) }
}
