import type { FxStatus } from '@/api/shared/fx'

export function getCashFlowFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Cash flow activity was already in your base currency'
    case 'complete':
      return 'Foreign currency cash flow activity was converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency cash flow activity could not be converted. Cash flow is incomplete and only includes activity with available conversion rates'
    case 'unavailable':
      return 'Foreign currency cash flow activity could not be converted. Cash flow is incomplete and only includes base currency activity'
  }
}

export function getTopCategoriesFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Category spending was already in your base currency'
    case 'complete':
      return 'Foreign currency category spending was converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency category spending could not be converted. Top categories are incomplete and only include spending with available conversion rates'
    case 'unavailable':
      return 'Foreign currency category spending could not be converted. Top categories are incomplete and only include base currency spending'
  }
}

export function getMostExpensiveTransactionsFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Transaction ranking used activity already in your base currency'
    case 'complete':
      return 'Foreign currency transaction amounts were converted into your base currency for ranking'
    case 'incomplete':
      return 'Some foreign currency transaction amounts could not be converted. Most expensive transactions are incomplete and only include transactions with available conversion rates'
    case 'unavailable':
      return 'Foreign currency transaction amounts could not be converted. Most expensive transactions are incomplete and only include base currency transactions'
  }
}
