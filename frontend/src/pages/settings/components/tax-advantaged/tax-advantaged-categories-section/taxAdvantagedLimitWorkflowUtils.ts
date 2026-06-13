import type { Currency } from '@/api/currency'
import type {
  TaxAdvantagedCategory,
  TaxAdvantagedCategoryLimit,
} from '@/api/taxAdvantagedCategories'
import type {
  TaxPlanLimitDraftState,
  TaxPlanLimitFormState,
} from '@/pages/settings/components/tax-advantaged/taxAdvantagedTypes'
import {
  fromMinorUnits,
  isValidMoneyInput,
  toMinorUnits,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/taxAdvantagedCategoryUtils'

/**
 * Creates a blank annual limit form for the supplied tax year
 */
export function createEmptyLimitForm(year: number): TaxPlanLimitFormState {
  return {
    year: String(year),
    contribution_limit: '',
    withdrawal_limit: '',
    accrued_contributions: '',
    accrued_withdrawals: '',
  }
}

/**
 * Builds the visible annual limit draft from saved data plus local edits
 */
export function getLimitDraft(
  year: number,
  limits: TaxAdvantagedCategoryLimit[],
  pendingDeletedLimit: TaxAdvantagedCategoryLimit | null,
  limitDrafts: Record<number, Partial<TaxPlanLimitDraftState>>,
  currencies: Currency[],
  plan: TaxAdvantagedCategory,
): TaxPlanLimitDraftState {
  const limit = limits.find((row) => row.year === year)
    ?? (pendingDeletedLimit?.year === year ? pendingDeletedLimit : undefined)

  return {
    contribution_limit: limitDrafts[year]?.contribution_limit
      ?? fromMinorUnits(limit?.contribution_limit ?? null, currencies, plan.currency),
    withdrawal_limit: limitDrafts[year]?.withdrawal_limit
      ?? fromMinorUnits(limit?.withdrawal_limit ?? null, currencies, plan.currency),
    accrued_contributions: limitDrafts[year]?.accrued_contributions
      ?? fromMinorUnits(limit?.accrued_contributions ?? null, currencies, plan.currency),
    accrued_withdrawals: limitDrafts[year]?.accrued_withdrawals
      ?? fromMinorUnits(limit?.accrued_withdrawals ?? null, currencies, plan.currency),
  }
}

/**
 * Compares the annual limit draft against the persisted minor-unit values
 */
export function isLimitDirty(
  year: number,
  limits: TaxAdvantagedCategoryLimit[],
  pendingDeletedLimit: TaxAdvantagedCategoryLimit | null,
  limitDrafts: Record<number, Partial<TaxPlanLimitDraftState>>,
  currencies: Currency[],
  plan: TaxAdvantagedCategory,
) {
  const limit = limits.find((row) => row.year === year)
    ?? (pendingDeletedLimit?.year === year ? pendingDeletedLimit : undefined)
  if (!limit) return false

  const draft = getLimitDraft(year, limits, pendingDeletedLimit, limitDrafts, currencies, plan)

  return toMinorUnits(draft.contribution_limit, currencies, plan.currency) !== limit.contribution_limit
    || toMinorUnits(draft.withdrawal_limit, currencies, plan.currency) !== limit.withdrawal_limit
    || (toMinorUnits(draft.accrued_contributions, currencies, plan.currency) ?? 0) !== limit.accrued_contributions
    || (toMinorUnits(draft.accrued_withdrawals, currencies, plan.currency) ?? 0) !== limit.accrued_withdrawals
}

/**
 * Validates an existing annual limit draft before autosaving
 */
export function validateExistingLimitDraft(year: number, draft: TaxPlanLimitDraftState) {
  if (!isValidMoneyInput(draft.contribution_limit, true)) {
    return `${year} contribution limit is required.`
  }
  if (!isValidMoneyInput(draft.withdrawal_limit)) {
    return `${year} withdrawal limit must be zero or higher.`
  }
  if (!isValidMoneyInput(draft.accrued_contributions)) {
    return `${year} opening contributions must be zero or higher.`
  }
  if (!isValidMoneyInput(draft.accrued_withdrawals)) {
    return `${year} opening withdrawals must be zero or higher.`
  }

  return null
}

/**
 * Validates the add-year draft before creating a new annual limit
 */
export function validateNewLimitForm(
  form: TaxPlanLimitFormState,
  limits: TaxAdvantagedCategoryLimit[],
  year: number,
) {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return 'Year must be between 1900 and 2100.'
  }
  if (limits.some((limit) => limit.year === year)) {
    return `A limit for ${year} already exists.`
  }
  if (!isValidMoneyInput(form.contribution_limit, true)) {
    return 'Contribution limit is required.'
  }
  if (!isValidMoneyInput(form.withdrawal_limit)) {
    return 'Withdrawal limit must be zero or higher.'
  }
  if (!isValidMoneyInput(form.accrued_contributions)) {
    return 'Opening contributions must be zero or higher.'
  }
  if (!isValidMoneyInput(form.accrued_withdrawals)) {
    return 'Opening withdrawals must be zero or higher.'
  }

  return null
}
