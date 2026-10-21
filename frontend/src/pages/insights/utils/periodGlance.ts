import type { InsightsPeriodGlanceResponse } from '@/api/insights'
import type { Currency } from '@/api/currency'
import { formatMovedCurrency } from '@/utils/formatCurrency'
import { formatMovedPercent } from '@/utils/negativeAmount'
import type {
  PeriodGlancePrimaryMetric,
  PeriodGlanceSupportItem,
} from '@/pages/insights/types/periodGlance'
import {
  formatSavingsRateValue,
} from './money'
import { getSavingsRate } from '@/utils/savingsRate'
import {
  getBiggestChangeFxStatusMessage,
  getNetWorthChangeFxStatusMessage,
  getPeriodSavingsRateFxStatusMessage,
  getPeriodTopCategoryFxStatusMessage,
} from './fxTooltipMessages'

type InsightSignal = {
  label: string
  value: string
  detail: string
  calculation?: string
  tone: PeriodGlancePrimaryMetric['tone']
  fxStatus?: PeriodGlanceSupportItem['fxStatus']
  getFxStatusMessage?: PeriodGlanceSupportItem['getFxStatusMessage']
}

type PeriodBrief = {
  metrics: Array<{
    label: string
    value: number
    detail: string
    calculation?: string
    tone: PeriodGlancePrimaryMetric['tone']
    fxStatus?: PeriodGlanceSupportItem['fxStatus']
    getFxStatusMessage?: PeriodGlanceSupportItem['getFxStatusMessage']
  }>
  signals: Array<{
    label: string
    value: string
    detail: string
    calculation?: string
    fxStatus?: PeriodGlanceSupportItem['fxStatus']
    getFxStatusMessage?: PeriodGlanceSupportItem['getFxStatusMessage']
  }>
}

export type PeriodGlanceCardData = {
  primaryMetric: PeriodGlancePrimaryMetric
  supportItems: PeriodGlanceSupportItem[]
  income: number
  expenses: number
}

function getPeriodGlanceChangeDetail(
  changeAmount: number,
  changePct: number | undefined,
  displayCurrency: string,
  currencies: Currency[],
) {
  const amount = formatMovedCurrency(changeAmount, displayCurrency, currencies)
  if (changePct === undefined) {
    return `${amount} vs previous matching period`
  }
  return `${amount} (${formatMovedPercent(changePct)}) vs previous matching period`
}

function getPeriodGlanceBrief(
  data: InsightsPeriodGlanceResponse,
  displayCurrency: string,
  currencies: Currency[],
): PeriodBrief {
  const netSavings = data.income - data.expenses
  const savingsRate = getSavingsRate(data.income, data.expenses)

  return {
    metrics: [
      {
        label: netSavings >= 0 ? 'You kept' : 'You overspent',
        value: netSavings,
        detail: netSavings >= 0
          ? 'Recorded income exceeds recorded expenses in the selected range, excluding transfers'
          : 'Recorded expenses exceed recorded income in the selected range, excluding transfers',
        calculation: 'Income - expenses for this range. Transfers are excluded',
        tone: netSavings >= 0 ? 'positive' : 'negative',
      },
      {
        label: 'Net worth changed by',
        value: data.net_worth_change,
        detail: 'Across all accounts',
        calculation: 'End-of-range account balances minus balances from the day before the range',
        tone: data.net_worth_change >= 0 ? 'positive' : 'negative',
        fxStatus: data.net_worth_change_fx_status,
        getFxStatusMessage: getNetWorthChangeFxStatusMessage,
      },
    ],
    signals: [
      {
        label: 'Biggest change',
        value: data.biggest_change_name ?? 'N/A',
        detail: data.biggest_change_name && data.biggest_change_amount !== undefined
          ? getPeriodGlanceChangeDetail(data.biggest_change_amount, data.biggest_change_pct, displayCurrency, currencies)
          : 'No comparable category movement in this range',
        calculation: 'Category with the largest dollar change from the previous matching period',
        fxStatus: data.biggest_change_fx_status,
        getFxStatusMessage: getBiggestChangeFxStatusMessage,
      },
      {
        label: 'Top category',
        value: data.top_category_name ?? 'N/A',
        detail: data.top_category_share_pct === undefined
          ? 'No recorded expenses in this range'
          : `${data.top_category_share_pct}% of recorded expenses`,
        calculation: 'Top spending category divided by total spending for this range',
        fxStatus: data.top_category_fx_status,
        getFxStatusMessage: getPeriodTopCategoryFxStatusMessage,
      },
      {
        label: 'Savings rate',
        value: formatSavingsRateValue(savingsRate),
        detail: savingsRate === null
          ? 'No recorded income in the selected range'
          : 'Income kept after expenses, excluding transfers',
        calculation: '(Income - expenses) / income for this range. Transfers are excluded',
        fxStatus: data.income_expense_fx_status,
        getFxStatusMessage: getPeriodSavingsRateFxStatusMessage,
      },
    ],
  }
}

function getLoadingPeriodGlanceBrief(): PeriodBrief {
  return {
    metrics: [
      {
        label: 'You kept',
        value: 0,
        detail: 'Loading period summary',
        tone: 'neutral',
      },
      {
        label: 'Net worth changed by',
        value: 0,
        detail: 'Loading tracked balance movement',
        tone: 'neutral',
      },
    ],
    signals: [
      {
        label: 'Biggest change',
        value: 'Loading',
        detail: 'Fetching comparable category movement',
      },
      {
        label: 'Top category',
        value: 'Loading',
        detail: 'Fetching recorded expense categories',
      },
      {
        label: 'Savings rate',
        value: 'Loading',
        detail: 'Fetching income and expense totals',
      },
    ],
  }
}

function getSupportItems(
  secondaryMetric: PeriodBrief['metrics'][number],
  signals: PeriodBrief['signals'],
  displayCurrency: string,
  currencies: Currency[],
) {
  const secondarySignal: InsightSignal = {
    label: secondaryMetric.label,
    value: formatMovedCurrency(secondaryMetric.value, displayCurrency, currencies),
    detail: secondaryMetric.detail,
    calculation: secondaryMetric.calculation,
    tone: secondaryMetric.tone,
    fxStatus: secondaryMetric.fxStatus,
    getFxStatusMessage: secondaryMetric.getFxStatusMessage,
  }

  return [
    secondarySignal,
    ...signals.map((signal) => ({
      label: signal.label,
      value: signal.value,
      detail: signal.detail,
      calculation: signal.calculation,
      tone: 'neutral' as const,
      fxStatus: signal.fxStatus,
      getFxStatusMessage: signal.getFxStatusMessage,
    })),
  ]
}

/**
 * Builds the period glance card's primary metric and supporting insight items from the raw
 * response, falling back to loading placeholders when the response has not arrived yet
 */
export function getPeriodGlanceCardData(
  data: InsightsPeriodGlanceResponse | undefined,
  displayCurrency: string,
  currencies: Currency[],
): PeriodGlanceCardData {
  const brief = data
    ? getPeriodGlanceBrief(data, displayCurrency, currencies)
    : getLoadingPeriodGlanceBrief()
  const primaryMetric = brief.metrics[0]
  const secondaryMetric = brief.metrics[1]

  return {
    primaryMetric: {
      label: primaryMetric.label,
      value: formatMovedCurrency(primaryMetric.value, displayCurrency, currencies),
      detail: primaryMetric.detail,
      calculation: primaryMetric.calculation,
      tone: primaryMetric.tone,
    },
    supportItems: getSupportItems(secondaryMetric, brief.signals, displayCurrency, currencies),
    income: data?.income ?? 0,
    expenses: data?.expenses ?? 0,
  }
}
