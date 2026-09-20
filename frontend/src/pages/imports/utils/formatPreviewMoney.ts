import type { Currency } from '@/api/currency'
import type { TransactionAmountPresentation } from '@/components/transactions/Row'
import { createMoneyFormatter } from '@/utils/formatCurrency'
import { DEFAULT_MINOR_UNIT_EXPONENT, findCurrencyExponent } from '@/utils/moneyInput'

/**
 * Formats exact preview minor units without narrowing their digits to a floating-point number
 *
 * Intl supplies grouping, currency placement and localized digits for the bigint whole units.
 * The separately formatted remainder replaces its zero fraction, preserving every currency place
 */
export function formatPreviewMoney(amount: bigint, currency: string, currencies: Currency[]): TransactionAmountPresentation {
  const exponent = findCurrencyExponent(currencies, currency)
    ?? new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits
    ?? DEFAULT_MINOR_UNIT_EXPONENT
  const divisor = 10n ** BigInt(exponent)
  const absolute = amount < 0n ? -amount : amount
  const whole = absolute / divisor
  const remainder = absolute % divisor
  const fraction = new Intl.NumberFormat(undefined, {
    useGrouping: false, minimumIntegerDigits: Math.max(1, exponent), maximumFractionDigits: 0,
  }).format(remainder)
  const magnitude = createMoneyFormatter(currency, exponent).formatToParts(whole)
    .map((part) => part.type === 'fraction' ? fraction : part.value).join('')
  const sign = amount < 0n ? -1 : amount > 0n ? 1 : 0
  return { text: `${sign < 0 ? '-' : '+'}${magnitude}`, sign }
}
