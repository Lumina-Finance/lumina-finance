import type { FxStatus } from '@/api/shared/fx'

export function getNetWorthFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'All account balances were already in your base currency'
    case 'complete':
      return 'Foreign currency account balances were converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency accounts could not be converted. Net worth is incomplete and only includes accounts with available conversion rates'
    case 'unavailable':
      return 'Foreign currency accounts could not be converted. Net worth is incomplete and only includes base currency accounts'
  }
}

export function getCreditFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'All credit balances and limits were already in your base currency'
    case 'complete':
      return 'Foreign currency credit balances and limits were converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency credit accounts could not be converted. Credit totals are incomplete and only include credit accounts with available conversion rates'
    case 'unavailable':
      return 'Foreign currency credit accounts could not be converted. Credit totals are incomplete and only include base currency credit accounts'
  }
}

export function getSavingsRateFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Income and expense activity was already in your base currency'
    case 'complete':
      return 'Foreign currency income and expenses were converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency income or expense activity could not be converted. Savings rate is incomplete and only includes activity with available conversion rates'
    case 'unavailable':
      return 'Foreign currency income and expense activity could not be converted. Savings rate is incomplete and only includes base currency activity'
  }
}

export function getRunwayFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Selected runway accounts and expense history were already in your base currency'
    case 'complete':
      return 'Foreign currency runway accounts and expense history were converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency runway accounts or expense history could not be converted. Runway is incomplete and only includes values with available conversion rates'
    case 'unavailable':
      return 'Foreign currency runway accounts and expense history could not be converted. Runway is incomplete and only includes base currency values'
  }
}

export function getSpendingComparisonFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Spending in this comparison was already in your base currency'
    case 'complete':
      return 'Foreign currency spending was converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency spending could not be converted. Spending comparison is incomplete and only includes spending with available conversion rates'
    case 'unavailable':
      return 'Foreign currency spending could not be converted. Spending comparison is incomplete and only includes base currency spending'
  }
}

export function getBreakdownFxStatusMessage(fxStatus: FxStatus, mode: 'spending' | 'income') {
  const metricLabel = mode === 'spending' ? 'Spending breakdown' : 'Income breakdown'
  const activityLabel = mode === 'spending' ? 'spending' : 'income'

  switch (fxStatus.state) {
    case 'none':
      return `${metricLabel} activity was already in your base currency`
    case 'complete':
      return `Foreign currency ${activityLabel} activity was converted into your base currency`
    case 'incomplete':
      return `Some foreign currency ${activityLabel} activity could not be converted. ${metricLabel} is incomplete and only includes activity with available conversion rates`
    case 'unavailable':
      return `Foreign currency ${activityLabel} activity could not be converted. ${metricLabel} is incomplete and only includes base currency activity`
  }
}

export function getTopBudgetsFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Budget activity was already in each budget\'s currency'
    case 'complete':
      return 'Foreign currency budget activity was converted into each budget\'s currency'
    case 'incomplete':
      return 'Some foreign currency budget activity could not be converted. Top budgets are incomplete and only include activity with available conversion rates'
    case 'unavailable':
      return 'Foreign currency budget activity could not be converted. Top budgets are incomplete and only include activity already in each budget\'s currency'
  }
}
