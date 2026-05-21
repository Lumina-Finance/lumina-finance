import type { InsightsPeriodGlanceResponse } from '@/api/insights'
import { formatCurrency } from '@/utils/formatCurrency'
import type {
  PeriodGlancePrimaryMetric,
  PeriodGlanceSupportItem,
} from '../components/PeriodGlanceCard'
import {
  formatSavingsRateValue,
  formatSignedCurrency,
  getSavingsRate,
} from './money'

type InsightSignal = {
  label: string
  value: string
  detail: string
  tone: PeriodGlancePrimaryMetric['tone']
}

type PeriodBrief = {
  metrics: Array<{
    label: string
    value: number
    detail: string
    tone: PeriodGlancePrimaryMetric['tone']
    signed?: boolean
  }>
  signals: Array<{
    label: string
    value: string
    detail: string
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
) {
  const amount = formatSignedCurrency(changeAmount, displayCurrency)
  if (changePct === undefined) {
    return `${amount} vs previous matching period`
  }
  return `${amount} (${changePct > 0 ? '+' : ''}${changePct}%) vs previous matching period`
}

function getPeriodGlanceBrief(data: InsightsPeriodGlanceResponse, displayCurrency: string): PeriodBrief {
  const netSavings = data.income - data.expenses
  const savingsRate = getSavingsRate(data.income, data.expenses)

  return {
    metrics: [
      {
        label: netSavings >= 0 ? 'You Kept' : 'You Overspent',
        value: netSavings,
        detail: netSavings >= 0
          ? 'Recorded income exceeds recorded expenses in the selected range, excluding transfers'
          : 'Recorded expenses exceed recorded income in the selected range, excluding transfers',
        tone: netSavings >= 0 ? 'positive' : 'negative',
      },
      {
        label: 'Net Worth Changed By',
        value: data.net_worth_change,
        detail: 'Across all accounts',
        tone: data.net_worth_change >= 0 ? 'positive' : 'negative',
        signed: true,
      },
    ],
    signals: [
      {
        label: 'Biggest Change',
        value: data.biggest_change_name ?? 'N/A',
        detail: data.biggest_change_name && data.biggest_change_amount !== undefined
          ? getPeriodGlanceChangeDetail(data.biggest_change_amount, data.biggest_change_pct, displayCurrency)
          : 'No comparable category movement in this range',
      },
      {
        label: 'Top Category',
        value: data.top_category_name ?? 'N/A',
        detail: data.top_category_share_pct === undefined
          ? 'No recorded expenses in this range'
          : `${data.top_category_share_pct}% of recorded expenses`,
      },
      {
        label: 'Savings Rate',
        value: formatSavingsRateValue(savingsRate),
        detail: savingsRate === null
          ? 'No recorded income in the selected range'
          : 'Income kept after expenses, excluding transfers',
      },
    ],
  }
}

function getLoadingPeriodGlanceBrief(): PeriodBrief {
  return {
    metrics: [
      {
        label: 'You Kept',
        value: 0,
        detail: 'Loading period summary',
        tone: 'neutral',
      },
      {
        label: 'Net Worth Changed By',
        value: 0,
        detail: 'Loading tracked balance movement',
        tone: 'neutral',
        signed: true,
      },
    ],
    signals: [
      {
        label: 'Biggest Change',
        value: 'Loading',
        detail: 'Fetching comparable category movement',
      },
      {
        label: 'Top Category',
        value: 'Loading',
        detail: 'Fetching recorded expense categories',
      },
      {
        label: 'Savings Rate',
        value: 'Loading',
        detail: 'Fetching income and expense totals',
      },
    ],
  }
}

function formatBriefMetricValue(
  metric: PeriodBrief['metrics'][number],
  displayCurrency: string,
) {
  return metric.signed
    ? formatSignedCurrency(metric.value, displayCurrency)
    : formatCurrency(metric.value, displayCurrency)
}

function getSupportItems(secondaryMetric: PeriodBrief['metrics'][number], signals: PeriodBrief['signals'], displayCurrency: string) {
  const secondarySignal: InsightSignal = {
    label: secondaryMetric.label,
    value: formatBriefMetricValue(secondaryMetric, displayCurrency),
    detail: secondaryMetric.detail,
    tone: secondaryMetric.tone,
  }

  return [
    secondarySignal,
    ...signals.map((signal) => ({
      label: signal.label,
      value: signal.value,
      detail: signal.detail,
      tone: 'neutral' as const,
    })),
  ]
}

export function getPeriodGlanceCardData(
  data: InsightsPeriodGlanceResponse | undefined,
  displayCurrency: string,
): PeriodGlanceCardData {
  const brief = data
    ? getPeriodGlanceBrief(data, displayCurrency)
    : getLoadingPeriodGlanceBrief()
  const primaryMetric = brief.metrics[0]
  const secondaryMetric = brief.metrics[1]

  return {
    primaryMetric: {
      label: primaryMetric.label,
      value: formatBriefMetricValue(primaryMetric, displayCurrency),
      detail: primaryMetric.detail,
      tone: primaryMetric.tone,
    },
    supportItems: getSupportItems(secondaryMetric, brief.signals, displayCurrency),
    income: data?.income ?? 0,
    expenses: data?.expenses ?? 0,
  }
}
