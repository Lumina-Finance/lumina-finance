export const CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS = {
  name: 'create-tac-name',
  taxTreatment: 'create-tac-tax-treatment',
  currency: 'create-tac-currency',
  lifetimeContributionLimit: 'create-tac-lifetime-contribution-limit',
  accruedContributions: 'create-tac-accrued-contributions',
  countsInternalTransfers: 'create-tac-counts-internal-transfers',
} as const

// The fields the Create category dialogue can refuse, in the order it draws them
export const CREATE_CATEGORY_VALIDATED_FIELDS = [
  'name',
  'currency',
  'lifetimeContributionLimit',
  'accruedContributions',
] as const

export type CreateCategoryField = (typeof CREATE_CATEGORY_VALIDATED_FIELDS)[number]

export const CREATE_CATEGORY_ERROR_IDS: Record<CreateCategoryField, string> = {
  name: 'create-tac-name-error',
  currency: 'create-tac-currency-error',
  lifetimeContributionLimit: 'create-tac-lifetime-contribution-limit-error',
  accruedContributions: 'create-tac-accrued-contributions-error',
}

export const CREATE_CATEGORY_CONTROL_IDS: Record<CreateCategoryField, string> = {
  name: CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.name,
  currency: CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.currency,
  lifetimeContributionLimit: CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.lifetimeContributionLimit,
  accruedContributions: CREATE_TAX_ADVANTAGED_CATEGORY_FIELD_IDS.accruedContributions,
}

export const CATEGORY_DETAILS_FIELD_IDS = {
  countsInternalTransfers: 'tac-details-counts-internal-transfers',
  taxTreatment: 'tac-details-tax-treatment',
  name: 'tac-details-name',
  lifetimeLimit: 'tac-details-lifetime-limit',
  openingUsage: 'tac-details-opening-usage',
} as const

// The fields the Category details dialogue can refuse, in the order it draws them
export const CATEGORY_DETAILS_VALIDATED_FIELDS = ['name', 'lifetimeLimit', 'openingUsage'] as const

export type CategoryDetailsField = (typeof CATEGORY_DETAILS_VALIDATED_FIELDS)[number]

export const CATEGORY_DETAILS_CONTROL_IDS: Record<CategoryDetailsField, string> = {
  name: CATEGORY_DETAILS_FIELD_IDS.name,
  lifetimeLimit: CATEGORY_DETAILS_FIELD_IDS.lifetimeLimit,
  openingUsage: CATEGORY_DETAILS_FIELD_IDS.openingUsage,
}

export const CATEGORY_DETAILS_ERROR_IDS: Record<CategoryDetailsField, string> = {
  name: 'tac-details-name-error',
  lifetimeLimit: 'tac-details-lifetime-limit-error',
  openingUsage: 'tac-details-opening-usage-error',
}

// The fields the annual limit dialogue can refuse, in the order it draws them. The year is only asked for
// when adding a year
export const LIMIT_VALIDATED_FIELDS = [
  'year',
  'contribution_limit',
  'accrued_contributions',
  'withdrawal_limit',
  'accrued_withdrawals',
] as const

export type LimitField = (typeof LIMIT_VALIDATED_FIELDS)[number]

// Each field's id comes from its limit key alone. The add and edit forms never show together and each
// holds one year, so no two fields on the page share a key
export const NEW_LIMIT_CONTROL_IDS: Record<LimitField, string> = {
  year: 'tac-new-limit-year',
  contribution_limit: 'tac-new-limit-contribution_limit',
  accrued_contributions: 'tac-new-limit-accrued_contributions',
  withdrawal_limit: 'tac-new-limit-withdrawal_limit',
  accrued_withdrawals: 'tac-new-limit-accrued_withdrawals',
}

export const EXISTING_LIMIT_CONTROL_IDS: Record<LimitField, string> = {
  year: NEW_LIMIT_CONTROL_IDS.year,
  contribution_limit: 'tac-limit-contribution_limit',
  accrued_contributions: 'tac-limit-accrued_contributions',
  withdrawal_limit: 'tac-limit-withdrawal_limit',
  accrued_withdrawals: 'tac-limit-accrued_withdrawals',
}
