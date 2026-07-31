export type TaxTreatment = 'tax_free' | 'tax_deferred' | 'tax_assisted';

export interface TaxAdvantagedCategory {
  id: string;
  category_owner_user_id: string;
  group_id: string | null;
  name: string;
  tax_treatment: TaxTreatment;
  currency: string;
  lifetime_contribution_limit: number | null;
  accrued_contributions: number;

  // Whether transfers with both sides inside this category count toward its limits
  counts_internal_transfers: boolean;
  accrued_lifetime_contribution_limit: number | null;
  current_year_contribution_limit: number | null;
  current_year_withdrawal_limit: number | null;
  ytd_contributions: number;
  ytd_withdrawals: number;
  lifetime_contributions: number;
  lifetime_withdrawals: number;
  created_at: string;
}

export interface TaxAdvantagedCategoryLimit {
  tax_advantaged_category_id: string;
  year: number;
  contribution_limit: number;
  withdrawal_limit: number | null;
  accrued_contributions: number;
  accrued_withdrawals: number;
}

export interface CreateTaxAdvantagedCategoryPayload {
  name: string;
  tax_treatment: TaxTreatment;
  currency: string;
  lifetime_contribution_limit: number | null;
  accrued_contributions?: number;

  // Defaults to false server-side when left out
  counts_internal_transfers?: boolean;
  group_id?: string | null;
}

export interface UpdateTaxAdvantagedCategoryPayload {
  name?: string;
  tax_treatment?: TaxTreatment;
  lifetime_contribution_limit?: number | null;
  accrued_contributions?: number;

  // Left out to leave the stored setting unchanged
  counts_internal_transfers?: boolean;
  group_id?: string | null;
}

export interface CreateTaxAdvantagedCategoryLimitPayload {
  categoryId: string;
  year: number;
  contribution_limit: number;
  withdrawal_limit: number | null;
  accrued_contributions?: number;
  accrued_withdrawals?: number;
}

export interface UpdateTaxAdvantagedCategoryLimitPayload {
  categoryId: string;
  year: number;
  contribution_limit?: number;
  withdrawal_limit?: number | null;
  accrued_contributions?: number;
  accrued_withdrawals?: number;
}
