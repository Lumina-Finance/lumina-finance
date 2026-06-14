import type { FxStatus } from '@/api/shared/fx'

/**
 * Explains how FX conversion affected account totals on the accounts summary
 */
export function getAccountSummaryFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'All account balances were already in your base currency'
    case 'complete':
      return 'Foreign currency account balances were converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency accounts could not be converted. Account totals are incomplete and only include accounts with available conversion rates'
    case 'unavailable':
      return 'Foreign currency accounts could not be converted. Account totals are incomplete and only include base currency accounts'
  }
}

/**
 * Explains how FX conversion affected an individual account balance
 */
export function getAccountBalanceFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'This account balance was already in your base currency'
    case 'complete':
      return 'This account balance was converted into your base currency'
    case 'incomplete':
      return 'This account balance could not be fully converted. The base-currency balance may be incomplete'
    case 'unavailable':
      return 'This account balance could not be converted into your base currency'
  }
}
