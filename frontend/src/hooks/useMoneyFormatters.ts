import { useMemo } from 'react'
import { useCurrencies } from '@/api/currency'
import type { Currency } from '@/api/currency'
import { type CompactMoneyRule, formatCompactMoney } from '@/utils/formatCompactMoney'
import { formatCurrency } from '@/utils/formatCurrency'

// A stable empty list, so the memo below does not rebuild the formatters on every render while the
// currency list is still on its way
const NO_CURRENCIES: Currency[] = []

type CompactMoneyOptions = Parameters<typeof formatCompactMoney>[4]

/**
 * Reads the currency list and returns the money formatters already bound to it
 *
 * Each currency's decimal places live in that list rather than in the browser, whose own figures
 * disagree with it for 16 codes, so a formatter cannot render an amount correctly without it. The
 * list is returned alongside the bound formatters for passing into the modules that format money
 * outside a component and so cannot call this
 *
 * Every authenticated screen renders below a gate that waits for the list, so the two-place fallback
 * inside the formatters only ever covers a code genuinely absent from a list that did arrive
 */
export function useMoneyFormatters() {
  const { data } = useCurrencies()
  const currencies = data ?? NO_CURRENCIES

  return useMemo(
    () => ({
      currencies,
      formatCurrency: (minorUnits: number, currency: string) =>
        formatCurrency(minorUnits, currency, currencies),
      formatCompactMoney: (
        minorUnits: number,
        currency: string,
        rules: CompactMoneyRule[],
        options?: CompactMoneyOptions,
      ) => formatCompactMoney(minorUnits, currency, rules, currencies, options),
    }),
    [currencies],
  )
}
