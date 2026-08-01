import type { TaxTreatment } from '@/api/tax-advantaged-categories'

export interface TaxPlanFormState {
  name: string
  tax_treatment: TaxTreatment
  currency: string
  lifetime_contribution_limit: string
  accrued_contributions: string
  counts_internal_transfers: boolean
}

export interface TaxPlanLimitFormState {
  year: string
  contribution_limit: string
  withdrawal_limit: string
  accrued_contributions: string
  accrued_withdrawals: string
}

export type TaxPlanLimitDraftField = keyof Pick<
  TaxPlanLimitFormState,
  'contribution_limit' | 'withdrawal_limit' | 'accrued_contributions' | 'accrued_withdrawals'
>

export type TaxPlanLimitDraftState = Pick<TaxPlanLimitFormState, TaxPlanLimitDraftField>

export interface AutosaveNotice {
  status: 'saving' | 'saved' | 'error'
  message: string
}

export type CategoryModalTab = 'limits' | 'accounts'
