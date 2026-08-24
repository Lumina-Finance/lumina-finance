import type { AccountKind, AccountType } from '@/api/accounts'
import type { FxStatus } from '@/api/shared/fx'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'

export interface FilterValues {
  institution_id?: string[]
  account_kind?: AccountKind[]
  account_type?: AccountType[]
}

export interface TaxAdvantagedLimitSummary {
  plan: TaxAdvantagedCategory
  linkedAccountCount: number
}

export interface AccountsMetricsViewModel {
  savingsRate: {
    value: number | null
    hasExpenses: boolean
    isLoading: boolean
    net: number
    income: number
    progress: number

    /** Colour of the figure */
    color: string

    /** Colour of the bar under it, drawn from the chart colours rather than the text ones */
    barColor: string
    fxStatus: FxStatus | undefined
  }
  creditUsage: {
    hasCreditAccounts: boolean
    hasCreditLimits: boolean
    hasCreditData: boolean
    isLoading: boolean
    utilization: number
    totalUsed: number
    totalLimit: number

    /** Colour of the figure */
    color: string

    /** Colour of the bar under it, drawn from the chart colours rather than the text ones */
    barColor: string
    fxStatus: FxStatus | undefined
  }
  runway: {
    label: string
    style: { bg: string; fg: string; label: string } | null
    fxStatus: FxStatus | undefined
    isLoading: boolean
    progress: number
    caption: string
    months: number | null
  }
}

export type AccountAccent = 'positive' | 'negative'
