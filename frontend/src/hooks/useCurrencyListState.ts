import { useCurrencies } from '@/api/currency'
import type { CurrencyListState } from '@/utils/currencyStatus'

/**
 * Reports whether the currency list is in hand, still on its way, or not coming
 *
 * This is the state of the list itself, so a list that has not arrived yet is never reported as one
 * that failed. A field holding a stored amount stands down on its own currency's decimal places
 * being unknown rather than on this, since a loaded list can still be missing that one currency, and
 * reads this only to say which of the reasons applies. A request that hangs is aborted by the
 * fetch's own timeout, so loading always ends
 */
export function useCurrencyListState(): CurrencyListState {
  const { data, isFetching } = useCurrencies()

  if (data?.length) return 'ready'

  return isFetching ? 'loading' : 'unavailable'
}
