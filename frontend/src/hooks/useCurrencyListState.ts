import { useCurrencies } from '@/api/currency'
import type { CurrencyListState } from '@/utils/currencyStatus'

/**
 * Reports whether the currency list is in hand, still on its way, or not coming
 *
 * Every surface that stands a field down or refuses a form reads this one rule, so a list that has not
 * arrived yet is never reported as one that failed. A request that hangs is aborted by the fetch's own
 * timeout, so loading always ends
 */
export function useCurrencyListState(): CurrencyListState {
  const { data, isFetching } = useCurrencies()

  if (data?.length) return 'ready'

  return isFetching ? 'loading' : 'unavailable'
}
