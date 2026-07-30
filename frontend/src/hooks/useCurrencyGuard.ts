import { useCallback } from 'react'
import { useCurrencyListState } from '@/hooks/useCurrencyListState'
import { useToast } from '@/hooks/useToast'
import { CURRENCY_LIST_REFUSAL, CURRENCY_LOADING_REFUSAL } from '@/utils/currencyStatus'

/**
 * Returns a function that runs an action only while the currency list is in hand, and otherwise says why
 * it did not
 *
 * Every form that creates something with an amount needs the list: there is no stored value to fall back
 * on and no way to convert what the user types without the currency's decimal places. Opening such a form
 * anyway would give the user fields that cannot be submitted, so the click is answered rather than spent.
 * A list still on its way says so instead, since telling the user to reload would be wrong
 */
export function useCurrencyGuard(): (action: () => void) => void {
  const currencyState = useCurrencyListState()
  const { showToast } = useToast()

  return useCallback((action: () => void) => {
    if (currencyState === 'ready') {
      action()
      return
    }

    showToast({
      status: 'error',
      text: currencyState === 'loading' ? CURRENCY_LOADING_REFUSAL : CURRENCY_LIST_REFUSAL,
    })
  }, [currencyState, showToast])
}
