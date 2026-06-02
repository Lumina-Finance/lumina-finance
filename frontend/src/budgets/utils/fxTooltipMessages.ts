import type { FxStatus } from '@/api/dashboard'

export function getBudgetUtilizationFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Budget activity was already in this budget\'s currency'
    case 'complete':
      return 'Foreign currency budget activity was converted into this budget\'s currency'
    case 'incomplete':
      return 'Some foreign currency budget activity could not be converted. Budget utilization is incomplete and only includes activity with available conversion rates'
    case 'unavailable':
      return 'Foreign currency budget activity could not be converted. Budget utilization is incomplete and only includes activity already in this budget\'s currency'
  }
}

export function getHistoricalBudgetUtilizationFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Historical budget activity was already in this budget\'s currency'
    case 'complete':
      return 'Foreign currency historical budget activity was converted into this budget\'s currency'
    case 'incomplete':
      return 'Some foreign currency historical budget activity could not be converted. Historical utilization is incomplete and only includes activity with available conversion rates'
    case 'unavailable':
      return 'Foreign currency historical budget activity could not be converted. Historical utilization is incomplete and only includes activity already in this budget\'s currency'
  }
}
