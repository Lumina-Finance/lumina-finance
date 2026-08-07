import { useMemo } from 'react'
import { useCurrencies } from '@/api/currency'
import type { Currency } from '@/api/currency'
import { formatCurrency } from '@/utils/formatCurrency'

// A stable empty list, so the memo below does not rebuild the formatter on every render while the
// currency list is still on its way
const NO_CURRENCIES: Currency[] = []

/**
 * Reads the currency list and returns the money formatter already bound to it
 *
 * Each currency's decimal places live in that list rather than in the browser, whose own figures
 * disagree with it for 16 codes, so a formatter cannot render an amount correctly without it. The
 * list is returned alongside the bound formatter for passing into the modules that format money
 * outside a component and so cannot call this, which is how every compact amount is reached
 */
export function useMoneyFormatters() {
  const { data } = useCurrencies()
  const currencies = data ?? NO_CURRENCIES

  return useMemo(
    () => ({
      currencies,
      formatCurrency: (minorUnits: number, currency: string) =>
        formatCurrency(minorUnits, currency, currencies),
    }),
    [currencies],
  )
}
