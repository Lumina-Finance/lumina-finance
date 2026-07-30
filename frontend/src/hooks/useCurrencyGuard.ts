import { useCallback } from 'react'
import { useCurrencies } from '@/api/currency'
import { useToast } from '@/hooks/useToast'
import { CURRENCY_LIST_REFUSAL } from '@/utils/currencyStatus'

/**
 * Returns a function that runs an action only while the currency list is in hand, and otherwise says why
 * it did not
 *
 * Every form that creates something with an amount needs the list: there is no stored value to fall back
 * on and no way to convert what the user types without the currency's decimal places. Opening such a form
 * anyway would give the user fields that cannot be submitted, so the click is answered rather than spent
 */
export function useCurrencyGuard(): (action: () => void) => void {
  const { data: currencies } = useCurrencies()
  const { showToast } = useToast()

  return useCallback((action: () => void) => {
    if (!currencies?.length) {
      showToast({ status: 'error', text: CURRENCY_LIST_REFUSAL })
      return
    }

    action()
  }, [currencies, showToast])
}
