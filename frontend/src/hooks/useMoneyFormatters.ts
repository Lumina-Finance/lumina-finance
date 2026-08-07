import { useMemo } from 'react'
import { useCurrencies } from '@/api/currency'
import type { Currency } from '@/api/currency'
import { formatCurrency } from '@/utils/formatCurrency'

// Only reached if this is somehow called above the gate in App.tsx that waits for the list, since no
// screen below that gate renders before the list is in hand. It is a stable reference rather than a
// fresh array so that, if it ever is reached, the memo below does not rebuild on every render
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
