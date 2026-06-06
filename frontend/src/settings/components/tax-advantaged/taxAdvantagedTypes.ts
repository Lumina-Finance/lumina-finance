import type { TaxTreatment } from '@/api/taxAdvantagedPlans'

export interface TaxPlanFormState {
  name: string
  tax_treatment: TaxTreatment
  currency: string
  lifetime_contribution_limit: string
  accrued_contributions: string
}

export interface TaxPlanLimitFormState {
  year: string
  contribution_limit: string
  withdrawal_limit: string
  accrued_contributions: string
  accrued_withdrawals: string
}

export interface AutosaveNotice {
  status: 'saving' | 'saved' | 'error'
  message: string
}

export type CategoryModalTab = 'limits' | 'accounts'
