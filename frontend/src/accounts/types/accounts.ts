import type { AccountKind, AccountType } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/taxAdvantagedCategories'

export interface AccountFilterValues {
  institution_id?: string
  account_kind?: AccountKind
  account_type?: AccountType
}

export interface TaxAdvantagedLimitSummary {
  plan: TaxAdvantagedCategory
  linkedAccountCount: number
}

export type AccountAccent = 'positive' | 'negative'
