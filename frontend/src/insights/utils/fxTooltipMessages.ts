import type { FxStatus } from '@/api/dashboard'

export function getPeriodIncomeExpenseFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Income and expense activity was already in your base currency'
    case 'complete':
      return 'Foreign currency income and expense activity was converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency income or expense activity could not be converted. This period summary is incomplete and only includes activity with available conversion rates'
    case 'unavailable':
      return 'Foreign currency income and expense activity could not be converted. This period summary is incomplete and only includes base currency activity'
  }
}

export function getPeriodSavingsRateFxStatusMessage(fxStatus: FxStatus) {
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

export function getNetWorthChangeFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Net worth change was calculated from balances already in your base currency'
    case 'complete':
      return 'Foreign currency account balances were converted into your base currency for net worth change'
    case 'incomplete':
      return 'Some foreign currency account balances could not be converted. Net worth change is incomplete and only includes accounts with available conversion rates'
    case 'unavailable':
      return 'Foreign currency account balances could not be converted. Net worth change is incomplete and only includes base currency accounts'
  }
}

export function getBiggestChangeFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Category movement was already in your base currency'
    case 'complete':
      return 'Foreign currency category movement was converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency category activity could not be converted. Biggest change is incomplete and only includes activity with available conversion rates'
    case 'unavailable':
      return 'Foreign currency category activity could not be converted. Biggest change is incomplete and only includes base currency activity'
  }
}

export function getPeriodTopCategoryFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Category spending was already in your base currency'
    case 'complete':
      return 'Foreign currency category spending was converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency category spending could not be converted. Top category is incomplete and only includes spending with available conversion rates'
    case 'unavailable':
      return 'Foreign currency category spending could not be converted. Top category is incomplete and only includes base currency spending'
  }
}

export function getFundFlowFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Fund flow activity was already in your base currency'
    case 'complete':
      return 'Foreign currency fund flow activity was converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency fund flow activity could not be converted. Fund flow is incomplete and only includes activity with available conversion rates'
    case 'unavailable':
      return 'Foreign currency fund flow activity could not be converted. Fund flow is incomplete and only includes base currency activity'
  }
}

export function getIncomeExpenseBreakdownFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Income and expense breakdown activity was already in your base currency'
    case 'complete':
      return 'Foreign currency income and expense breakdown activity was converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency income or expense activity could not be converted. Breakdown is incomplete and only includes activity with available conversion rates'
    case 'unavailable':
      return 'Foreign currency income and expense activity could not be converted. Breakdown is incomplete and only includes base currency activity'
  }
}

export function getInsightsNetWorthFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Net worth values were already in your base currency'
    case 'complete':
      return 'Foreign currency net worth values were converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency account balances could not be converted. Net worth is incomplete and only includes accounts with available conversion rates'
    case 'unavailable':
      return 'Foreign currency account balances could not be converted. Net worth is incomplete and only includes base currency accounts'
  }
}

export function getInsightsCashFlowFxStatusMessage(fxStatus: FxStatus) {
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

export function getSavingsRateTrendFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Savings rate history was already in your base currency'
    case 'complete':
      return 'Foreign currency savings rate history was converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency savings rate history could not be converted. Savings rate trend is incomplete and only includes activity with available conversion rates'
    case 'unavailable':
      return 'Foreign currency savings rate history could not be converted. Savings rate trend is incomplete and only includes base currency activity'
  }
}

export function getMerchantSpendingFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'Merchant spending was already in your base currency'
    case 'complete':
      return 'Foreign currency merchant spending was converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency merchant spending could not be converted. Merchant insights are incomplete and only include spending with available conversion rates'
    case 'unavailable':
      return 'Foreign currency merchant spending could not be converted. Merchant insights are incomplete and only include base currency spending'
  }
}
