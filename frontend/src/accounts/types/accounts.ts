import type { AccountKind, AccountType } from '@/api/accounts'
import type { TaxAdvantagedPlan } from '@/api/taxAdvantagedPlans'

export interface AccountFilterValues {
  institution_id?: string
  account_kind?: AccountKind
  account_type?: AccountType
}

export interface TaxAdvantagedLimitSummary {
  plan: TaxAdvantagedPlan
  linkedAccountCount: number
}

export type AccountAccent = 'positive' | 'negative'
